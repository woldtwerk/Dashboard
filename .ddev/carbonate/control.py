#!/usr/bin/env python3
"""Control API for carbonate.

Runs `carbonate auth` to sign a Proton account in and then `carbonate serve` to
offer the same session over CalDAV and CardDAV, so the dashboard's setup wizard
can connect Proton Calendar and Contacts without a terminal.

POST /login    {username, password, mailboxPassword?, totp?, verificationToken?} -> {account, dav}
GET  /status   -> {signedIn, account, davUrl, serving}
GET  /health   -> {ready}

`dav` is {url, username, password}: the bridge password encrypts the session
file and is the DAV password. Every call but /health needs
`Authorization: Bearer $CARBONATE_CONTROL_TOKEN`.

carbonate is unreleased third-party software talking to Proton's private API;
see the Dockerfile. Its `auth --password-stdin` mode reads answers from stdin in
the order the login flow asks for them, and prints nothing for the two-factor
and mailbox prompts — only the human-verification challenge is announced. That
shapes the flow below: all answers are offered up front, and a human
verification is answered in place so the challenge stays valid while the user
solves it in a browser.
"""

import base64
import hmac
import json
import os
import re
import secrets
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ['CARBONATE_CONTROL_TOKEN']
CONTROL_PORT = int(os.environ.get('CARBONATE_CONTROL_PORT', '8080'))
DAV_PORT = int(os.environ.get('CARBONATE_DAV_PORT', '8081'))
SESSION = os.environ.get('CARBONATE_SESSION', '/home/carbonate/auth.json')
BRIDGE_PASSWORD_FILE = os.environ.get('CARBONATE_BRIDGE_PASSWORD_FILE', '/home/carbonate/bridge-password')
# Address the dashboard (on the same Docker network) reaches CalDAV/CardDAV at
DAV_URL = os.environ.get('CARBONATE_DAV_URL', f'http://carbonate:{DAV_PORT}').rstrip('/')
WATCH = os.environ.get('CARBONATE_WATCH', '5m')

# Proton's login may take a moment; a verification challenge shows up soon after
# the login request, so this is the time to give it before assuming none came
VERIFY_WINDOW = float(os.environ.get('CARBONATE_VERIFY_WINDOW', '12'))
AUTH_TIMEOUT = float(os.environ.get('CARBONATE_AUTH_TIMEOUT', '300'))
# How long a human-verification challenge may stay open before it is abandoned
VERIFY_TTL = float(os.environ.get('CARBONATE_VERIFY_TTL', '600'))
# How often the watchdog looks for an abandoned challenge
WATCHDOG_INTERVAL = float(os.environ.get('CARBONATE_WATCHDOG_INTERVAL', '30'))
ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]|\x1b[=>]|[\r\x08]')
CONTROL_CHARS = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')

# Output of `carbonate auth`
URL_PATTERN = re.compile(r'https://verify\.proton\.me/\?\S+')
SUCCESS_PATTERN = re.compile(r'Logged in as \S+')
EOF_TOTP = re.compile(r'stdin ended before answering "Two-factor code: "')
EOF_MAILBOX = re.compile(r'stdin ended before answering "Mailbox password: "')
EOF_VERIFY = re.compile(r'stdin ended before answering "Verification token: "')
FATAL = re.compile(r'^carbonate: (?!stdin ended)(.+)$', re.M)

OUTCOMES = [
    URL_PATTERN,
    SUCCESS_PATTERN,
    EOF_TOTP,
    EOF_MAILBOX,
    EOF_VERIFY,
    FATAL
]


class CarbonateError(Exception):
    def __init__(self, status, message, need=None, verification_url=None):
        super().__init__(message)
        self.status = status
        self.need = need
        self.verification_url = verification_url


class AuthFlow:
    """One `carbonate auth` process, driven through its standard input."""

    def __init__(self, username):
        self.username = username
        self.password_sent = False
        self.verification_sent = False
        self.totp_sent = False
        self.mailbox_sent = False
        self.output = ''
        self.changed = threading.Condition()
        self.ended = False
        self.code = None
        self.process = None
        # Set while a human-verification challenge is open and unanswered
        self.challenge_since = None

    def start(self, bridge_password):
        env = dict(os.environ, CARBONATE_BRIDGE_PASSWORD=bridge_password)
        self.process = subprocess.Popen(
            ['carbonate', 'auth', self.username, '--password-stdin', '-keep-bridge-password', '-session', SESSION],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env
        )
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        while True:
            data = self.process.stdout.readline()
            if not data:
                break
            with self.changed:
                self.output += ANSI.sub('', data.decode('utf-8', 'replace'))
                self.changed.notify_all()
        self.code = self.process.wait()
        with self.changed:
            self.ended = True
            self.changed.notify_all()
        print(f'carbonate auth for {self.username} exited with {self.code}', flush=True)

    @property
    def running(self):
        return self.process is not None and self.process.poll() is None

    def send(self, line):
        if not self.running or self.process.stdin.closed:
            raise CarbonateError(409, 'The sign-in is no longer waiting for input')
        self.process.stdin.write((line + '\n').encode())
        self.process.stdin.flush()

    def close_stdin(self):
        if self.process.stdin and not self.process.stdin.closed:
            self.process.stdin.close()

    def expect(self, patterns, timeout):
        """Wait for one of the patterns; returns (index, match) and consumes up to it."""
        deadline = time.monotonic() + timeout
        with self.changed:
            while True:
                for index, pattern in enumerate(patterns):
                    match = pattern.search(self.output)
                    if match:
                        self.output = self.output[match.end():]
                        return index, match
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None, None
                self.changed.wait(remaining)

    def tail(self):
        lines = [line.strip() for line in self.output.split('\n') if line.strip()]
        return lines[-1] if lines else ''

    def stop(self):
        if self.running:
            self.process.kill()
            self.process.wait()


class Carbonate:
    """The single account the container is signed in to."""

    def __init__(self):
        self.lock = threading.Lock()
        self.auth = None
        self.serve = None

    # --- Bridge password and session ---

    def bridge_password(self):
        """The password encrypting the session, generated once and kept on the volume."""
        if os.path.exists(BRIDGE_PASSWORD_FILE):
            with open(BRIDGE_PASSWORD_FILE) as file:
                password = file.read().strip()
            if password:
                return password

        password = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('=')
        write_private(BRIDGE_PASSWORD_FILE, password + '\n')
        return password

    # --- Serve ---

    def serve_status(self):
        return self.serve is not None and self.serve.poll() is None

    def start_serve(self):
        self.stop_serve()
        env = dict(os.environ, CARBONATE_BRIDGE_PASSWORD=self.bridge_password())
        self.serve = subprocess.Popen(
            ['carbonate', 'serve', '-addr', f'0.0.0.0:{DAV_PORT}', '-session', SESSION, '-watch', WATCH],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
            env=env
        )
        print(f'carbonate serve started (pid {self.serve.pid})', flush=True)

    def stop_serve(self):
        if self.serve_status():
            self.serve.terminate()
            try:
                self.serve.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.serve.kill()
                self.serve.wait()
        self.serve = None

    # --- Login ---

    def login(self, username, password, mailbox=None, totp=None, verification=None):
        with self.lock:
            # The session is locked while serve runs, so it has to step aside for auth
            self.stop_serve()

            flow = self.auth
            # An open challenge survives only a request that answers it; without
            # a token this is a new attempt, so the old one is abandoned.
            if flow is not None and flow.running and flow.challenge_since and not flow.verification_sent and not verification:
                self._reset_flow()
                flow = None
            if flow is not None and (flow.username != username or not flow.running):
                flow.stop()
                flow = None
            if flow is None:
                flow = AuthFlow(username)
                self.auth = flow

            try:
                if not flow.password_sent:
                    flow.start(self.bridge_password())
                    flow.send(password)
                    flow.password_sent = True
                self._drive(flow, totp, mailbox, verification)
            except CarbonateError as error:
                # A human-verification challenge stays open, so the solved token
                # still fits it; every other failure gives the DAV session back.
                if error.need == 'verificationToken' and flow.running:
                    raise
                self._reset_flow()
                self._resume_serve()
                raise
            except OSError:
                # The auth binary could not run; the stored session may still serve
                self._reset_flow()
                self._resume_serve()
                raise

            account = flow.username
            self.auth = None
            bridge = self.bridge_password()
            self.start_serve()

            return {
                'account': account,
                'dav': {'url': DAV_URL, 'username': username, 'password': bridge}
            }

    def _reset_flow(self):
        """Stop the running auth process, releasing the session it holds."""
        if self.auth is not None:
            self.auth.stop()
        self.auth = None

    def _resume_serve(self):
        """Bring the previously working session back online after a failed login."""
        if not os.path.exists(SESSION):
            return
        try:
            self.start_serve()
        except OSError as error:
            print(f'carbonate serve could not restart: {error}', flush=True)

    def watchdog(self):
        """Abandon a human-verification challenge nobody came back to."""
        while True:
            time.sleep(WATCHDOG_INTERVAL)
            with self.lock:
                flow = self.auth
                if flow is None or not flow.running or flow.verification_sent or not flow.challenge_since:
                    continue
                if time.monotonic() - flow.challenge_since > VERIFY_TTL:
                    print('abandoning an unanswered verification challenge', flush=True)
                    self._reset_flow()
                    self._resume_serve()

    def _drive(self, flow, totp, mailbox, verification):
        """Feed the flow what it can take, in the order carbonate asks for it."""
        # A verification token was already solved for this challenge: answer it
        # before the two-factor code, which Proton asks for only afterwards.
        if verification and not flow.verification_sent:
            flow.send(verification)
            flow.verification_sent = True
            flow.challenge_since = None

        # Without a token, a challenge may still be coming; sending the 2FA code
        # now would have it taken for the challenge answer. Wait to see.
        if verification or not self._challenge_possible(flow):
            self._send_credentials(flow, totp, mailbox)
            return self._settle(flow, verification)

        return self._await_challenge(flow, totp, mailbox)

    def _challenge_possible(self, flow):
        # A new flow may yet be asked to prove it is human; an answered one not
        return flow.running and not flow.verification_sent

    def _await_challenge(self, flow, totp, mailbox):
        """Watch for a verification challenge before committing the other answers."""
        deadline = time.monotonic() + VERIFY_WINDOW
        while True:
            index, match = flow.expect(OUTCOMES, timeout=max(0.0, deadline - time.monotonic()))
            if index is None:
                break
            if index == 0:
                # The user has to solve this in a browser; keep the process
                # alive so the token they bring back still fits this challenge
                flow.challenge_since = time.monotonic()
                raise CarbonateError(400, 'Proton wants human verification', need='verificationToken', verification_url=match.group(0))
            if index == 1:
                return self._finish(flow)
            self._outcome(index, match)

        # No challenge arrived: answer the rest and let the login finish
        self._send_credentials(flow, totp, mailbox)
        return self._settle(flow, None)

    def _send_credentials(self, flow, totp, mailbox):
        if not flow.running:
            return
        if totp and not flow.totp_sent:
            flow.send(totp)
            flow.totp_sent = True
        if mailbox and not flow.mailbox_sent:
            flow.send(mailbox)
            flow.mailbox_sent = True
        # Everything the caller has was offered; closing stdin makes a prompt we
        # could not see (2FA, mailbox password) fail at once instead of hanging.
        flow.close_stdin()

    def _settle(self, flow, verification):
        """Wait for the login to succeed or name the input it still needs."""
        deadline = time.monotonic() + AUTH_TIMEOUT
        while True:
            index, match = flow.expect(OUTCOMES, timeout=max(0.0, deadline - time.monotonic()))
            if index is None:
                if flow.running:
                    raise CarbonateError(504, 'Proton sign-in timed out')
                if flow.code == 0:
                    return
                raise CarbonateError(400, flow.tail() or 'Proton sign-in did not complete')
            if index == 0:
                # A second challenge in the same login
                flow.challenge_since = time.monotonic()
                raise CarbonateError(400, 'Proton wants human verification', need='verificationToken', verification_url=match.group(0))
            if index == 1:
                return self._finish(flow)
            self._outcome(index, match)

    def _outcome(self, index, match):
        if index == 2:
            raise CarbonateError(400, 'Enter the two-factor code of your authenticator app', need='totp')
        if index == 3:
            raise CarbonateError(400, 'This account uses a mailbox password. Enter it as well.', need='mailboxPassword')
        if index == 4:
            raise CarbonateError(400, 'Proton wants human verification', need='verificationToken')
        raise CarbonateError(400, match.group(1).strip())

    def _finish(self, flow):
        """Wait for auth to exit, which releases the session lock serve needs."""
        deadline = time.monotonic() + 30
        while flow.running and time.monotonic() < deadline:
            time.sleep(0.1)
        if flow.running:
            raise CarbonateError(504, 'carbonate auth did not exit')
        if flow.code != 0:
            raise CarbonateError(400, flow.tail() or 'Proton sign-in did not complete')


def write_private(path, contents):
    """Write a secret 0600, so the session file beside it has the same protection."""
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, mode=0o700, exist_ok=True)
    with open(path, 'w') as file:
        file.write(contents)
    os.chmod(path, 0o600)


def text(body, key, required=True):
    value = body.get(key)
    if value is None or value == '':
        if required:
            raise CarbonateError(400, f'{key} is required')
        return None
    if not isinstance(value, str) or len(value) > 4096 or CONTROL_CHARS.search(value):
        raise CarbonateError(400, f'{key} is invalid')
    return value


carbonate = Carbonate()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            return self.reply(200, {'ready': True})
        if self.path == '/status':
            return self.authorized(self.status)
        self.reply(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path == '/login':
            return self.authorized(self.login)
        if self.path == '/logout':
            return self.authorized(self.logout)
        self.reply(404, {'error': 'Not found'})

    def status(self):
        signed_in = os.path.exists(SESSION)
        if not signed_in:
            return {'signedIn': False, 'serving': False}
        return {
            'signedIn': True,
            'account': self._account(),
            'davUrl': DAV_URL,
            'serving': carbonate.serve_status()
        }

    def _account(self):
        # The DAV username; the session file is encrypted, so name the flow only
        # when it is still around, otherwise report that a session exists
        return carbonate.auth.username if carbonate.auth else None

    def login(self):
        body = self.body()
        return carbonate.login(
            text(body, 'username'),
            text(body, 'password'),
            text(body, 'mailboxPassword', False),
            text(body, 'totp', False),
            text(body, 'verificationToken', False)
        )

    def logout(self):
        with carbonate.lock:
            carbonate.stop_serve()
            if carbonate.auth:
                carbonate.auth.stop()
                carbonate.auth = None
            if os.path.exists(SESSION):
                os.remove(SESSION)
        return {'signedIn': False}

    def body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length > 64 * 1024:
            raise CarbonateError(413, 'Request too large')
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            raise CarbonateError(400, 'Invalid JSON')
        if not isinstance(body, dict):
            raise CarbonateError(400, 'Invalid JSON')
        return body

    def authorized(self, action):
        expected = f'Bearer {TOKEN}'.encode()
        if not hmac.compare_digest(self.headers.get('Authorization', '').encode(), expected):
            return self.reply(401, {'error': 'Unauthorized'})
        try:
            self.reply(200, action())
        except CarbonateError as error:
            self.reply(error.status, {
                'error': str(error),
                'need': error.need,
                'verificationUrl': error.verification_url
            })

    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        # Paths name accounts; log only method and status
        print(f'{self.command} {self.path.split("/")[1]} {args[1] if len(args) > 1 else ""}', flush=True)


def main():
    # A session left from a previous run is served straight away
    if os.path.exists(SESSION):
        carbonate.start_serve()
    threading.Thread(target=carbonate.watchdog, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', CONTROL_PORT), Handler).serve_forever()


if __name__ == '__main__':
    main()
