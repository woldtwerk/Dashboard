#!/usr/bin/env python3
"""Control API for Proton Mail Bridge.

Runs `protonmail-bridge --cli` in a pseudo terminal and drives its interactive
shell, so the dashboard can sign accounts in without a terminal. That process
is the Bridge serving IMAP; the container lives as long as it does.

POST /login            {username, password, totp?, mailboxPassword?} -> account
GET  /accounts/<name>  -> account
GET  /health           -> {ready}

An account is {account, imap: {username, password, port}, smtp: {port}, cert};
SMTP uses the same username and password as IMAP. Every call but /health needs
`Authorization: Bearer $BRIDGE_CONTROL_TOKEN`.
"""

import fcntl
import hmac
import json
import os
import pty
import re
import socket
import ssl
import struct
import sys
import termios
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

TOKEN = os.environ['BRIDGE_CONTROL_TOKEN']
CONTROL_PORT = int(os.environ.get('BRIDGE_CONTROL_PORT', '8080'))
# Port socat forwards to Bridge's own IMAP port
IMAP_PORT = int(os.environ.get('BRIDGE_IMAP_PORT', '1144'))
BRIDGE_IMAP_PORT = 1143
# Port socat forwards to Bridge's own SMTP port (STARTTLS)
SMTP_PORT = int(os.environ.get('BRIDGE_SMTP_PORT', '1026'))
BRIDGE_SMTP_PORT = 1025

ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]|\x1b[=>]|[\r\x08]')
SHELL_PROMPT = re.compile(r'>>>\s*$')
USERNAME_PROMPT = re.compile(r'username:\s*$', re.I)
PASSWORD_PROMPT = re.compile(r'(?<!mailbox )password:\s*$', re.I)
TOTP_PROMPT = re.compile(r'two factor code:\s*$', re.I)
MAILBOX_PROMPT = re.compile(r'mailbox password:\s*$', re.I)
SECURITY_KEY_QUESTION = re.compile(r'security key[^\n]*\?[^\n]*$', re.I)
ADDED = re.compile(r'Account (\S+) was added successfully')
IMAP_INFO = re.compile(
    r'IMAP Settings\s+Address:\s*\S+\s+IMAP port:\s*(\d+)\s+Username:\s*(\S+)\s+Password:\s*(\S+)')
# Only the port is needed; SMTP uses the IMAP username and password
SMTP_INFO = re.compile(
    r'SMTP Settings\s+Address:\s*\S+\s+SMTP port:\s*(\d+)')
API_ERROR = re.compile(r'\d{3} [A-Z]+ https?://\S+: (.+?)(?: \(Code=.*)?$')

# Typed into the shell, so a line break would start another command
CONTROL_CHARS = re.compile(r'[\x00-\x1f\x7f]')


class BridgeError(Exception):
    def __init__(self, status, message, need=None):
        super().__init__(message)
        self.status = status
        self.need = need


class BridgeShell:
    """The interactive Bridge CLI. One dialog at a time."""

    def __init__(self):
        self.output = ''
        self.changed = threading.Condition()
        self.lock = threading.Lock()
        self.ready = False

        pid, self.fd = pty.fork()
        if pid == 0:
            os.environ['TERM'] = 'dumb'
            os.execvp('protonmail-bridge', ['protonmail-bridge', '--cli'])

        self.pid = pid
        # Wide enough that long lines (IMAP password) never wrap
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 400, 0, 0))
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        while True:
            try:
                data = os.read(self.fd, 4096)
            except OSError:
                data = b''
            if not data:
                # Without Bridge there is nothing to control; let the container stop
                print('Bridge exited', file=sys.stderr, flush=True)
                os._exit(1)
            with self.changed:
                self.output += ANSI.sub('', data.decode('utf-8', 'replace'))
                self.changed.notify_all()

    def start(self):
        with self.lock:
            self.expect([SHELL_PROMPT], timeout=300)
            self.ready = True
        print('Bridge is ready', flush=True)

    def send(self, line):
        os.write(self.fd, (line + '\r').encode())

    def expect(self, patterns, timeout=60):
        """Wait for one of the patterns; returns (index, output before it, match) and consumes both."""
        deadline = time.monotonic() + timeout
        with self.changed:
            while True:
                for index, pattern in enumerate(patterns):
                    match = pattern.search(self.output)
                    if match:
                        before = self.output[:match.start()]
                        self.output = self.output[match.end():]
                        return index, before, match
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise BridgeError(504, 'Proton Bridge did not respond in time')
                self.changed.wait(remaining)

    def _clear(self):
        with self.changed:
            self.output = ''

    def _cancel_prompt(self):
        """Answer prompts empty until Bridge gives up and is back at the shell."""
        for _ in range(6):
            self.send('')
            index, _, _ = self.expect([SHELL_PROMPT, TOTP_PROMPT, MAILBOX_PROMPT, PASSWORD_PROMPT, USERNAME_PROMPT])
            if index == 0:
                return
        raise BridgeError(500, 'Proton Bridge is stuck in a prompt')

    def login(self, username, password, totp=None, mailbox_password=None):
        with self._dialog():
            self.send('login')
            self.expect([USERNAME_PROMPT])
            self.send(username)
            self.expect([PASSWORD_PROMPT])
            self.send(password)

            while True:
                index, before, match = self.expect(
                    [ADDED, TOTP_PROMPT, MAILBOX_PROMPT, SECURITY_KEY_QUESTION, SHELL_PROMPT], timeout=180)

                if index == 0:
                    account = match.group(1)
                    self.expect([SHELL_PROMPT])
                    break
                if index == 1:
                    if not totp:
                        self._cancel_prompt()
                        raise BridgeError(400, 'Enter the two-factor code of your authenticator app', need='totp')
                    self.send(totp)
                    # A code is only valid once; a second prompt means it was wrong
                    totp = None
                elif index == 2:
                    if not mailbox_password:
                        self._cancel_prompt()
                        raise BridgeError(400, 'This account uses a mailbox password. Enter it as well.', need='mailboxPassword')
                    self.send(mailbox_password)
                    mailbox_password = None
                elif index == 3:
                    # Security keys need a device at this machine; fall back to the authenticator app
                    self.send('no')
                else:
                    message = last_message(before)
                    if 'already' not in message.lower():
                        raise BridgeError(400, message or 'Proton Bridge could not sign in')
                    account = username
                    break

            return self._account(account)

    def account(self, name):
        with self._dialog():
            return self._account(name)

    def _account(self, name):
        self.send(f'info {name}')
        _, before, _ = self.expect([SHELL_PROMPT])
        match = IMAP_INFO.search(before)
        if not match:
            raise BridgeError(404, f'Proton Bridge has no account "{name}"')

        port, username, password = match.groups()
        if int(port) != BRIDGE_IMAP_PORT:
            raise BridgeError(500, f'Bridge listens on IMAP port {port}, the container forwards {BRIDGE_IMAP_PORT}')

        smtp = SMTP_INFO.search(before)
        if smtp and int(smtp.group(1)) != BRIDGE_SMTP_PORT:
            raise BridgeError(500, f'Bridge listens on SMTP port {smtp.group(1)}, the container forwards {BRIDGE_SMTP_PORT}')

        return {
            'account': name,
            'imap': {'username': username, 'password': password, 'port': IMAP_PORT},
            'smtp': {'port': SMTP_PORT},
            'cert': bridge_certificate()
        }

    def _dialog(self):
        shell = self

        class Dialog:
            def __enter__(self):
                if not shell.ready:
                    raise BridgeError(503, 'Proton Bridge is still starting')
                if not shell.lock.acquire(timeout=5):
                    raise BridgeError(409, 'Proton Bridge is busy with another sign-in')
                shell._clear()

            def __exit__(self, *_):
                shell.lock.release()

        return Dialog()


def last_message(output):
    """Last line Bridge printed, without the echoed input and progress notes."""
    lines = [line.strip() for line in output.split('\n')]
    lines = [line for line in lines if line and not line.startswith('Authenticating')]
    if not lines:
        return ''
    # "Cannot login: … 422 POST https://…/auth/v4: This username does not exist. (Code=8002, …)"
    api_error = API_ERROR.search(lines[-1])
    return api_error.group(1) if api_error else lines[-1]


def bridge_certificate():
    """Bridge's self-signed certificate, read over loopback inside this container."""
    with socket.create_connection(('127.0.0.1', BRIDGE_IMAP_PORT), timeout=10) as sock:
        reader = sock.makefile('rb')
        reader.readline()
        sock.sendall(b'a1 STARTTLS\r\n')
        line = reader.readline()
        while line and not line.startswith(b'a1 '):
            line = reader.readline()
        if not line.startswith(b'a1 OK'):
            raise BridgeError(502, 'Proton Bridge refused STARTTLS')

        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        with context.wrap_socket(sock) as tls:
            return ssl.DER_cert_to_PEM_cert(tls.getpeercert(binary_form=True))


def text(body, key, required=True):
    value = body.get(key)
    if value is None or value == '':
        if required:
            raise BridgeError(400, f'{key} is required')
        return None
    if not isinstance(value, str) or len(value) > 1024 or CONTROL_CHARS.search(value):
        raise BridgeError(400, f'{key} is invalid')
    return value


shell = BridgeShell()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            return self.reply(200 if shell.ready else 503, {'ready': shell.ready})
        if self.path.startswith('/accounts/'):
            return self.authorized(lambda: shell.account(self.account_name()))
        self.reply(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path == '/login':
            return self.authorized(self.login)
        self.reply(404, {'error': 'Not found'})

    def login(self):
        body = self.body()
        username = text(body, 'username')
        if re.search(r'\s', username):
            raise BridgeError(400, 'username is invalid')
        return shell.login(username, text(body, 'password'), text(body, 'totp', False), text(body, 'mailboxPassword', False))

    def account_name(self):
        name = unquote(self.path[len('/accounts/'):])
        if not name or re.search(r'\s', name) or CONTROL_CHARS.search(name):
            raise BridgeError(400, 'account is invalid')
        return name

    def body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length > 64 * 1024:
            raise BridgeError(413, 'Request too large')
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            raise BridgeError(400, 'Invalid JSON')
        if not isinstance(body, dict):
            raise BridgeError(400, 'Invalid JSON')
        return body

    def authorized(self, action):
        expected = f'Bearer {TOKEN}'.encode()
        if not hmac.compare_digest(self.headers.get('Authorization', '').encode(), expected):
            return self.reply(401, {'error': 'Unauthorized'})
        try:
            self.reply(200, action())
        except BridgeError as error:
            self.reply(error.status, {'error': str(error), 'need': error.need})
        except OSError:
            self.reply(502, {'error': 'Proton Bridge IMAP is not reachable'})

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


if __name__ == '__main__':
    threading.Thread(target=shell.start, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', CONTROL_PORT), Handler).serve_forever()
