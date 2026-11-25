#!/usr/bin/env python3
"""Control API for lumo-tamer.

lumo-tamer proxies Proton's Lumo behind an OpenAI-compatible API, but it has no
HTTP login of its own: signing in is `tamer auth login`, which prompts on a
terminal. This container runs `tamer server` as a child and drives that CLI over
a pseudo terminal, so the dashboard's setup wizard can sign the account in.

GET  /health  -> {ready}
GET  /status  -> {signedIn, email?, baseUrl, apiKey, warnings?}
POST /login   {email, password, totp?} -> session
POST /logout  -> {signedIn: false}

The proxy listens on port 3003, this API on 3004. Everything but /health needs
`Authorization: Bearer $TAMER_CONTROL_TOKEN`.

The child is spawned only when a vault exists, because the server cannot start
without one, and restarted after every sign-in: it reads the vault at startup
and keeps the tokens in memory, so a vault written by the login process would
not be picked up otherwise. The control API stays up while the child is down or
fails to start, so the wizard can show what went wrong.
"""

import fcntl
import hmac
import json
import os
import pty
import re
import signal
import struct
import subprocess
import sys
import termios
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ['TAMER_CONTROL_TOKEN']
# The proxy's own bearer key, rendered into config.yaml by ensure-secrets.sh
API_KEY = os.environ['TAMER_API_KEY']
CONTROL_PORT = int(os.environ.get('TAMER_CONTROL_PORT', '3004'))
PROXY_PORT = int(os.environ.get('TAMER_PORT', '3003'))
# Address the dashboard reaches the OpenAI-compatible API at
PUBLIC_BASE_URL = os.environ.get('TAMER_PUBLIC_BASE_URL', f'http://tamer:{PROXY_PORT}/v1')
PROJECT_DIR = os.environ.get('TAMER_HOME', '/app')
VAULT = os.environ.get('TAMER_VAULT_PATH', os.path.join(PROJECT_DIR, 'sessions', 'vault.enc'))
# Proton's SRP is slow; a CAPTCHA failure is not
LOGIN_TIMEOUT = float(os.environ.get('TAMER_LOGIN_TIMEOUT', '200'))
# How long `tamer server` may take to answer /health
START_TIMEOUT = float(os.environ.get('TAMER_START_TIMEOUT', '60'))

ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]|\x1b[=>]|[\r\x08]')
# The prompts the Go login binary prints on stderr
USERNAME_PROMPT = re.compile(r'Proton username \(email\):\s*$')
PASSWORD_PROMPT = re.compile(r'Password:\s*$')
TOTP_PROMPT = re.compile(r'2FA TOTP code:\s*$')
# pino-pretty line: "12:34:56 ERROR: message"
LOG_PREFIX = re.compile(r'^(?:\[\d{2}:\d{2}:\d{2}\]|\d{2}:\d{2}:\d{2})\s+[A-Z]+:\s*')

# Typed into a prompt, so a line break would answer the next one
CONTROL_CHARS = re.compile(r'[\x00-\x1f\x7f]')


class TamerError(Exception):
    def __init__(self, status, message, need=None):
        super().__init__(message)
        self.status = status
        self.need = need


class Pty:
    """One child on a pseudo terminal, for a CLI that prompts on one."""

    def __init__(self, argv):
        self.output = ''
        # Everything the child printed, for the error message after it ended
        self.history = ''
        self.changed = threading.Condition()
        self.closed = False
        self.exitcode = None

        pid, self.fd = pty.fork()
        if pid == 0:
            os.environ['TERM'] = 'dumb'
            os.chdir(PROJECT_DIR)
            os.execvp(argv[0], argv)

        self.pid = pid
        # Wide enough that long lines never wrap
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 200, 0, 0))
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        while True:
            try:
                data = os.read(self.fd, 4096)
            except OSError:
                data = b''
            with self.changed:
                if data:
                    text = ANSI.sub('', data.decode('utf-8', 'replace'))
                    self.output += text
                    self.history = (self.history + text)[-65536:]
                    self.changed.notify_all()
                    continue
                self.closed = True
                self.changed.notify_all()
            break

        _, status = os.waitpid(self.pid, 0)
        with self.changed:
            self.exitcode = os.waitstatus_to_exitcode(status)
            self.changed.notify_all()

    def send(self, line):
        os.write(self.fd, (line + '\r').encode())

    def expect(self, patterns, timeout=60):
        """Wait for one of the patterns; returns (index, output before it, match) and consumes both.

        The index is None when the child ended before one of the patterns appeared.
        """
        deadline = time.monotonic() + timeout
        with self.changed:
            while True:
                for index, pattern in enumerate(patterns):
                    match = pattern.search(self.output)
                    if match:
                        before = self.output[:match.start()]
                        self.output = self.output[match.end():]
                        return index, before, match
                if self.closed:
                    before = self.output
                    self.output = ''
                    return None, before, None
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TamerError(504, 'lumo-tamer did not respond in time')
                self.changed.wait(remaining)

    def wait(self, timeout):
        deadline = time.monotonic() + timeout
        with self.changed:
            while self.exitcode is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TamerError(504, 'lumo-tamer did not finish in time')
                self.changed.wait(remaining)
        return self.exitcode

    def kill(self):
        """Ends a dialog nobody waits for, with whatever it spawned; the read thread reaps it."""
        if self.exitcode is None:
            try:
                # pty.fork() puts the child in its own session, so this reaches the Go binary too
                os.killpg(self.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def proxy_json(path, method='GET', payload=None, timeout=5, token=API_KEY):
    """Calls the proxy on loopback; None when it does not answer."""
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(f'http://127.0.0.1:{PROXY_PORT}{path}', data=data, method=method)
    if token:
        request.add_header('Authorization', f'Bearer {token}')
    if data is not None:
        request.add_header('Content-Type', 'application/json')

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
    except (urllib.error.URLError, OSError):
        return None

    try:
        return json.loads(body or b'{}')
    except ValueError:
        return None


def last_message(output):
    """Last line the CLI printed, without the log prefix and the prompts."""
    lines = [LOG_PREFIX.sub('', line.strip()) for line in output.split('\n')]
    lines = [line for line in lines if line and not re.search(r':\s*$', line)]
    if not lines:
        return ''
    # The upstream error is wrapped twice: "Authentication failed: 2FA failed: …"
    return lines[-1][:400]


class Supervisor:
    """Owns the `tamer server` child and the single sign-in dialog."""

    def __init__(self):
        self.process = None
        self.start_lock = threading.Lock()
        self.dialog = threading.Lock()
        self.ready = False
        # Remembered from the sign-in; the vault does not hold the address
        self.email = None

    @property
    def running(self):
        return self.process is not None and self.process.poll() is None

    def start(self):
        """Spawns the proxy when a vault exists; True once it answers /health."""
        with self.start_lock:
            if self.running:
                return True
            if not os.path.isfile(VAULT):
                print('No vault yet, the proxy starts after a sign-in', flush=True)
                return False

            self.process = subprocess.Popen(
                ['tamer', 'server'],
                cwd=PROJECT_DIR,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT)
            threading.Thread(target=self._log, args=(self.process,), daemon=True).start()

            deadline = time.monotonic() + START_TIMEOUT
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    print(f'tamer server exited with {self.process.returncode}', flush=True)
                    return False
                if proxy_json('/health', timeout=2, token=None):
                    print('tamer server is ready', flush=True)
                    return True
                time.sleep(0.5)

            print('tamer server did not answer /health in time', flush=True)
            return False

    def stop(self):
        """SIGTERM the child and wait; nothing to do when it already exited."""
        with self.start_lock:
            process, self.process = self.process, None
            if process is None or process.poll() is not None:
                return
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

    def _log(self, process):
        for line in process.stdout:
            print(ANSI.sub('', line.decode('utf-8', 'replace')), end='', flush=True)
        process.wait()
        print(f'tamer server exited with {process.returncode}', flush=True)

    def status(self):
        signed_in = False
        warnings = []
        if self.running:
            payload = proxy_json('/v1/auth/status')
            if payload and payload.get('valid'):
                signed_in = True
                warnings = payload.get('warnings') or []

        result = {'signedIn': signed_in}
        if signed_in and self.email:
            result['email'] = self.email
        result['baseUrl'] = PUBLIC_BASE_URL
        result['apiKey'] = API_KEY
        if warnings:
            result['warnings'] = warnings
        return result

    def login(self, email, password, totp=None):
        if not self.dialog.acquire(timeout=5):
            raise TamerError(409, 'lumo-tamer is busy with another sign-in')
        try:
            return self._login(email, password, totp)
        finally:
            self.dialog.release()

    def _login(self, email, password, totp):
        # The CLI writes the vault; nothing else may hold it and keep its own tokens
        self.stop()

        process = Pty(['tamer', 'auth', 'login'])
        try:
            self._answer(process, email, password, totp)
        except TamerError:
            process.kill()
            # A failed attempt must not leave an earlier session stopped
            self.start()
            raise
        process.kill()

        if process.exitcode != 0:
            message = last_message(process.history) or 'Proton could not sign in'
            self.start()
            # A CAPTCHA makes SRP fail and the login method cannot solve one; anything
            # else (a typo'd password) is passed on as it is
            raise TamerError(400, message, need='captcha' if re.search(r'captcha', message, re.I) else None)

        self.email = email
        if not self.start():
            raise TamerError(502, 'Signed in, but the proxy did not start; check the container log')
        return {'signedIn': True, 'email': email, 'baseUrl': PUBLIC_BASE_URL, 'apiKey': API_KEY}

    def _answer(self, process, email, password, totp):
        """Answers the login prompts; a wrong code or a CAPTCHA ends the child."""
        process.expect([USERNAME_PROMPT], timeout=60)
        process.send(email)
        process.expect([PASSWORD_PROMPT], timeout=60)
        process.send(password)

        index, _, _ = process.expect([TOTP_PROMPT], timeout=LOGIN_TIMEOUT)
        if index is None:
            # Accounts without 2FA end right after the password
            process.wait(30)
            return

        if not totp:
            # Answer empty so the CLI gives up instead of waiting forever
            process.send('')
            process.wait(30)
            raise TamerError(400, 'Enter the two-factor code of your authenticator app', need='totp')

        process.send(totp)
        process.wait(LOGIN_TIMEOUT)

    def logout(self):
        if not self.dialog.acquire(timeout=5):
            raise TamerError(409, 'lumo-tamer is busy with a sign-in')
        try:
            if self.running:
                # The child revokes the session, deletes the vault and exits
                proxy_json('/v1/auth/logout', method='POST', payload={}, timeout=15)
            self.stop()
            if os.path.exists(VAULT):
                os.unlink(VAULT)
            self.email = None
            return {'signedIn': False}
        finally:
            self.dialog.release()


def text(body, key, required=True):
    value = body.get(key)
    if value is None or value == '':
        if required:
            raise TamerError(400, f'{key} is required')
        return None
    if not isinstance(value, str) or len(value) > 1024 or CONTROL_CHARS.search(value):
        raise TamerError(400, f'{key} is invalid')
    return value


supervisor = Supervisor()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            return self.reply(200, {'ready': supervisor.ready})
        if self.path == '/status':
            return self.authorized(supervisor.status)
        self.reply(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path == '/login':
            return self.authorized(self.login)
        if self.path == '/logout':
            return self.authorized(supervisor.logout)
        self.reply(404, {'error': 'Not found'})

    def login(self):
        body = self.body()
        email = text(body, 'email')
        if '@' not in email or re.search(r'\s', email):
            raise TamerError(400, 'email is invalid')
        return supervisor.login(email, text(body, 'password'), text(body, 'totp', False))

    def body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length > 64 * 1024:
            raise TamerError(413, 'Request too large')
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            raise TamerError(400, 'Invalid JSON')
        if not isinstance(body, dict):
            raise TamerError(400, 'Invalid JSON')
        return body

    def authorized(self, action):
        expected = f'Bearer {TOKEN}'.encode()
        if not hmac.compare_digest(self.headers.get('Authorization', '').encode(), expected):
            return self.reply(401, {'error': 'Unauthorized'})
        try:
            outcome = action()
        except TamerError as error:
            return self.reply(error.status, {'error': str(error), 'need': error.need})
        except OSError as error:
            return self.reply(502, {'error': f'lumo-tamer is not reachable: {error}'})
        self.reply(200, outcome)

    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        # The login body holds the password; paths and status only
        print(f'{self.command} {self.path} {args[1] if len(args) > 1 else ""}', flush=True)


def shutdown(*_):
    supervisor.stop()
    os._exit(0)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    def boot():
        try:
            supervisor.start()
        except OSError as error:
            print(f'tamer server could not start: {error}', file=sys.stderr, flush=True)
        supervisor.ready = True

    threading.Thread(target=boot, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', CONTROL_PORT), Handler).serve_forever()
