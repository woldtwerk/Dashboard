#!/usr/bin/env python3
"""Control API for the Proton Drive CLI.

Runs the official `proton-drive` binary so the dashboard's setup wizard can sign
an account in (the CLI prints a browser URL and waits) and the file explorer can
list, upload, download and manage files without a terminal.

GET  /health        -> {ready}
GET  /status        -> {signedIn, account}
GET  /login/status  -> {pending, signedIn, error}
GET  /download?path=…&path=… -> file or zip stream
POST /login         -> {signInUrl}          starts `auth login`, keeps it running
POST /logout        -> {signedIn: false}
POST /command       {argv: [...]} -> {exitCode, stdout, stderr}
POST /upload?path=… multipart body -> {exitCode, stdout, stderr}

Everything but /health needs `Authorization: Bearer $PROTON_DRIVE_CONTROL_TOKEN`.

The CLI session is a single account in a single container, so every command runs
under one lock: the session may not tolerate parallel use. A long upload or
download holds it, and a read-only command that cannot get it in time gets a 423
busy instead of waiting; a sign-in is exclusive and answers 409. Uploads and
downloads go through the control API so temporary files stay in unique
directories that are removed again, and large files are streamed, never buffered
in memory.
"""

import hmac
import io
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

TOKEN = os.environ['PROTON_DRIVE_CONTROL_TOKEN']
CONTROL_PORT = int(os.environ.get('PROTON_DRIVE_CONTROL_PORT', '8080'))
CLI = os.environ.get('PROTON_DRIVE_BIN', 'proton-drive')
# Where unique temp directories for uploads and downloads are created
TMP_ROOT = os.environ.get('PROTON_DRIVE_TMP_DIR', '/tmp')
# Largest upload accepted, so one request cannot fill the volume
MAX_UPLOAD_BYTES = int(os.environ.get('PROTON_DRIVE_MAX_UPLOAD_BYTES', str(4 * 1024 * 1024 * 1024)))
# A command that lists or moves files should not run forever
COMMAND_TIMEOUT = float(os.environ.get('PROTON_DRIVE_COMMAND_TIMEOUT', '300'))
# A read-only command waits this long for a transfer to finish, then reports busy
COMMAND_LOCK_TIMEOUT = float(os.environ.get('PROTON_DRIVE_COMMAND_LOCK_TIMEOUT', '15'))
# A transfer waits this long for another transfer; uploads and downloads queue
TRANSFER_LOCK_TIMEOUT = float(os.environ.get('PROTON_DRIVE_TRANSFER_LOCK_TIMEOUT', '1800'))
# A single upload or download may take this long
TRANSFER_TIMEOUT = float(os.environ.get('PROTON_DRIVE_TRANSFER_TIMEOUT', '1800'))
# How long `/login` waits for the CLI to print its sign-in URL
LOGIN_URL_TIMEOUT = float(os.environ.get('PROTON_DRIVE_LOGIN_URL_TIMEOUT', '60'))
# How long an unfinished sign-in may stay open before it is abandoned
LOGIN_TTL = float(os.environ.get('PROTON_DRIVE_LOGIN_TTL', '600'))
# How long a signed-in check (`filesystem list /`) may take
STATUS_TIMEOUT = float(os.environ.get('PROTON_DRIVE_STATUS_TIMEOUT', '30'))
# A successful command counts as proof of a live session for this long
STATUS_FRESH = float(os.environ.get('PROTON_DRIVE_STATUS_FRESH', '60'))

ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]|\x1b[=>]|[\r\x08]')
CONTROL_CHARS = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
SIGN_IN_URL = re.compile(r'"signInUrl"\s*:\s*"([^"]+)"')
BARE_URL = re.compile(r'https://\S+')

# Subcommands the command endpoint may run, with the flags each accepts.
# Upload and download have dedicated endpoints; auth runs inside the control API.
COMMANDS = {
    ('filesystem', 'list'): {'-t'},
    ('filesystem', 'info'): set(),
    ('filesystem', 'size'): set(),
    ('filesystem', 'create-folder'): set(),
    ('filesystem', 'rename'): set(),
    ('filesystem', 'copy'): {'-n'},
    ('filesystem', 'move'): set(),
    ('filesystem', 'trash'): set(),
    ('filesystem', 'restore'): set(),
    ('filesystem', 'delete'): set(),
    ('filesystem', 'empty-trash'): set(),
    ('sharing', 'status'): set(),
    ('sharing', 'set-url'): {'--role', '--password', '--expiration'},
    ('sharing', 'remove-url'): set(),
    ('invitation', 'list'): set(),
    ('invitation', 'accept'): set(),
    ('invitation', 'reject'): set()
}


class DriveError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Budget:
    """Counts bytes read for a request, so a body cannot exceed the cap."""

    def __init__(self, limit):
        self.limit = limit
        self.used = 0

    def spend(self, count):
        self.used += count
        if self.used > self.limit:
            raise DriveError(413, 'Request too large')


class Pushback:
    """A reader with a small pushback buffer, for multipart boundary scanning."""

    def __init__(self, reader):
        self.reader = reader
        self.buffer = b''

    def readline(self):
        if self.buffer:
            newline = self.buffer.find(b'\n')
            if newline != -1:
                line = self.buffer[:newline + 1]
                self.buffer = self.buffer[newline + 1:]
                return line
        return self.buffer_join(self.reader.readline())

    def read(self, size):
        if self.buffer:
            chunk = self.buffer[:size]
            self.buffer = self.buffer[size:]
            if chunk:
                return chunk
        # read1 returns what is available; read() would block for the full size
        reader = getattr(self.reader, 'read1', None) or self.reader.read
        return reader(size)

    def buffer_join(self, data):
        if self.buffer:
            data = self.buffer + data
            self.buffer = b''
        return data

    def push(self, data):
        self.buffer = data + self.buffer


def boundary_of(content_type):
    match = re.search(r'boundary="?([^";]+)"?', content_type or '', re.I)
    if not match:
        raise DriveError(400, 'Expected a multipart/form-data body')
    return match.group(1).encode()


def read_until_boundary(reader, delimiter, sink, budget):
    """Stream bytes into `sink` until the next boundary; returns whether it was the last."""
    tail = b''
    keep = len(delimiter) + 4
    marker = b'\r\n' + delimiter

    while True:
        chunk = reader.read(65536)
        if not chunk:
            raise DriveError(400, 'Unexpected end of the upload')
        budget.spend(len(chunk))
        data = tail + chunk
        index = data.find(marker)
        if index == -1:
            if len(data) > keep:
                sink.write(data[:-keep])
                tail = data[-keep:]
            else:
                tail = data
            continue

        sink.write(data[:index])
        rest = data[index + 2:]
        newline = rest.find(b'\n')
        if newline == -1:
            raise DriveError(400, 'Incomplete multipart boundary')
        line = rest[:newline].rstrip(b'\r')
        reader.push(rest[newline + 1:])
        return line == delimiter + b'--'


def parse_multipart(reader, content_type, budget, dest_dir):
    """Write every file part of a multipart body to `dest_dir`; return the local paths."""
    delimiter = b'--' + boundary_of(content_type)
    paths = []

    if reader.readline().rstrip(b'\r\n') != delimiter:
        raise DriveError(400, 'Malformed multipart body')

    while True:
        headers = {}
        while True:
            line = reader.readline()
            if not line:
                raise DriveError(400, 'Unexpected end of the upload')
            if line in (b'\r\n', b'\n'):
                break
            name, _, value = line.decode('utf-8', 'replace').partition(':')
            headers[name.strip().lower()] = value.strip()

        disposition = headers.get('content-disposition', '')
        filename = re.search(r'filename="([^"]*)"', disposition)
        has_file = bool(filename and filename.group(1))
        # Only files are uploaded; ignore any other field
        sink = io.BytesIO()
        path = None
        if has_file:
            path = unique_path(dest_dir, upload_name(filename.group(1)))
            sink = open(path, 'wb')

        try:
            last = read_until_boundary(reader, delimiter, sink, budget)
        finally:
            if has_file:
                sink.close()

        if has_file and path:
            paths.append(path)
        if last:
            return paths


def upload_name(raw):
    """The bare name of an uploaded part; `.`, `..` and empty are not file names."""
    name = os.path.basename(raw.replace('\\', '/')).strip()
    if not name or name in ('.', '..'):
        raise DriveError(400, 'The upload has an invalid file name')
    return name


def unique_path(directory, name):
    """A path in `directory` for `name`, never overwriting another part."""
    candidate = os.path.join(directory, name)
    counter = 1
    while os.path.exists(candidate):
        stem, extension = os.path.splitext(name)
        candidate = os.path.join(directory, f'{stem}-{counter}{extension}')
        counter += 1
    return candidate


def validate_argv(argv):
    """Only a whitelisted subcommand with its known flags may run."""
    if not isinstance(argv, list) or len(argv) < 2 or not all(isinstance(item, str) for item in argv):
        raise DriveError(400, 'argv must be a list of at least two strings')

    for token in argv:
        if not token or len(token) > 4096 or CONTROL_CHARS.search(token):
            raise DriveError(400, 'An argument is invalid')

    allowed_flags = COMMANDS.get((argv[0], argv[1]))
    if allowed_flags is None:
        raise DriveError(400, f'Command "{argv[0]} {argv[1]}" is not allowed')

    expect_value = False
    for token in argv[2:]:
        if expect_value:
            expect_value = False
            continue
        if token.startswith('-'):
            if token not in allowed_flags:
                raise DriveError(400, f'Flag "{token}" is not allowed')
            expect_value = True
        elif token.startswith('/'):
            check_path(token)


def spawn(argv, stdin=None, env=None):
    return subprocess.Popen(
        [CLI] + argv,
        stdin=stdin,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env or dict(os.environ)
    )


class LoginFlow:
    """One `proton-drive auth login` process, kept alive until it finishes."""

    def __init__(self):
        self.process = None
        self.output = ''
        self.changed = threading.Condition()
        self.sign_in_url = None
        self.error = None

    def start(self):
        self.process = spawn(['auth', 'login', '-j'])
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        while True:
            line = self.process.stdout.readline()
            if not line:
                break
            with self.changed:
                self.output += ANSI.sub('', line.decode('utf-8', 'replace'))
                match = SIGN_IN_URL.search(self.output)
                if match and not self.sign_in_url:
                    self.sign_in_url = match.group(1)
                self.changed.notify_all()
        self.process.wait()
        with self.changed:
            if self.process.returncode != 0 and not self.error:
                self.error = self.tail()
            self.changed.notify_all()
        print(f'proton-drive auth login exited with {self.process.returncode}', flush=True)

    @property
    def running(self):
        return self.process is not None and self.process.poll() is None

    @property
    def succeeded(self):
        return self.process is not None and self.process.returncode == 0

    def wait_for_url(self, timeout):
        deadline = time.monotonic() + timeout
        with self.changed:
            while not self.sign_in_url and self.running:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                # A non-JSON build prints the URL on its own line
                match = BARE_URL.search(self.output)
                if match:
                    self.sign_in_url = match.group(0)
                    return self.sign_in_url
                self.changed.wait(min(remaining, 1))
        return self.sign_in_url

    def tail(self):
        lines = [line.strip() for line in self.output.split('\n') if line.strip()]
        return lines[-1] if lines else 'Proton Drive could not sign in'

    def stop(self):
        if self.running:
            self.process.kill()
            self.process.wait()


class Drive:
    """The single account the container is signed in to."""

    def __init__(self):
        # Every CLI invocation runs under this lock; the session may dislike parallel use
        self.lock = threading.Lock()
        # Guards `login` itself, so state reads and writes never race
        self.state_lock = threading.Lock()
        self.login = None
        # Monotonic time of the last successful CLI command, so /status can answer
        # without running one
        self.last_success = None

    @property
    def signing_in(self):
        with self.state_lock:
            return self.login is not None

    def signed_in(self):
        """Whether the session is usable.

        A command that succeeded within the last minute proves it without running
        another, and a command in flight is assumed to be a signed-in one: waiting
        for the lock would make a busy transfer look like a signed-out session.
        """
        if self.last_success is not None and time.monotonic() - self.last_success < STATUS_FRESH:
            return True
        if self.lock.locked():
            return True
        try:
            result = self.run(['filesystem', 'list', '-j', '/'], timeout=STATUS_TIMEOUT)
        except DriveError:
            return False
        return result['exitCode'] == 0

    def run(self, argv, timeout=COMMAND_TIMEOUT, lock_timeout=None):
        """Runs one CLI command. The sign-in is exclusive; a transfer may be running."""
        if self.signing_in:
            raise DriveError(409, 'Proton Drive is signing in')
        if lock_timeout is None:
            lock_timeout = COMMAND_LOCK_TIMEOUT
        if not self.lock.acquire(timeout=lock_timeout):
            raise DriveError(423, 'Proton Drive is busy with a transfer')
        try:
            try:
                process = subprocess.run(
                    [CLI] + argv,
                    capture_output=True,
                    timeout=timeout,
                    env=dict(os.environ)
                )
            except subprocess.TimeoutExpired:
                raise DriveError(504, 'Proton Drive did not respond in time')
            except OSError as error:
                raise DriveError(502, f'Proton Drive could not run: {error}')
        finally:
            self.lock.release()

        if process.returncode == 0:
            self.last_success = time.monotonic()

        return {
            'exitCode': process.returncode,
            'stdout': process.stdout.decode('utf-8', 'replace'),
            'stderr': ANSI.sub('', process.stderr.decode('utf-8', 'replace'))
        }

    def start_login(self):
        with self.state_lock:
            flow = self.login
            if flow is not None and flow.running:
                return flow

            flow = LoginFlow()
            self.login = flow
            flow.start()

        # A watchdog ends a sign-in nobody finishes and clears the state after it exits
        threading.Thread(target=self._watch_login, args=(flow,), daemon=True).start()

        url = flow.wait_for_url(LOGIN_URL_TIMEOUT)
        if not url:
            flow.stop()
            self._finish_login(flow)
            raise DriveError(504, 'Proton Drive did not offer a sign-in URL')
        return flow

    def _watch_login(self, flow):
        try:
            flow.process.wait(timeout=LOGIN_TTL)
        except subprocess.TimeoutExpired:
            print('abandoning an unfinished sign-in', flush=True)
            flow.stop()
        self._finish_login(flow)

    def _finish_login(self, flow):
        with self.state_lock:
            if self.login is flow:
                self.login = None

    def logout(self):
        with self.state_lock:
            flow = self.login
            self.login = None
        if flow is not None and flow.running:
            flow.stop()
        self.run(['auth', 'logout'])
        # A logout is not proof of a live session, even though the command succeeded
        self.last_success = None


def text_query(query, key, required=True):
    values = query.get(key) or []
    value = values[0] if values else None
    if not value:
        if required:
            raise DriveError(400, f'{key} is required')
        return None
    if len(value) > 4096 or CONTROL_CHARS.search(value):
        raise DriveError(400, f'{key} is invalid')
    return value


def check_path(value):
    """Reject a `..` segment, so a path cannot climb out of the account root."""
    if re.search(r'(^|/)\.\.(/|$)', value):
        raise DriveError(400, 'The path is invalid')


def safe_filename(path):
    """The display name of a path, with the CLI's escaped slashes undone."""
    name = path.rstrip('/').split('/')[-1]
    return name.replace('\\/', '/') or 'drive'


drive = Drive()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == '/health':
            return self.reply(200, {'ready': os.path.exists(shutil.which(CLI) or '')})
        if parsed.path == '/status':
            return self.authorized(lambda: self.status())
        if parsed.path == '/login/status':
            return self.authorized(lambda: self.login_status())
        if parsed.path == '/download':
            return self.authorized(lambda: self.download(parse_qs(parsed.query)))
        self.reply(404, {'error': 'Not found'})

    def do_POST(self):
        parsed = urlsplit(self.path)
        if parsed.path == '/login':
            return self.authorized(self.start_login)
        if parsed.path == '/logout':
            return self.authorized(self.logout)
        if parsed.path == '/command':
            return self.authorized(self.run_command)
        if parsed.path == '/upload':
            return self.authorized(lambda: self.upload(parse_qs(parsed.query)))
        self.reply(404, {'error': 'Not found'})

    def status(self):
        # A sign-in or a transfer is reported as not-yet-signed-in by run(); never wait on it
        return {'signedIn': drive.signed_in(), 'account': None}

    def login_status(self):
        flow = drive.login
        if flow is None:
            return {'pending': False, 'signedIn': drive.signed_in(), 'error': None}
        return {
            'pending': flow.running,
            'signedIn': flow.succeeded,
            'error': flow.error
        }

    def start_login(self):
        flow = drive.start_login()
        return {'signInUrl': flow.sign_in_url}

    def logout(self):
        drive.logout()
        return {'signedIn': False}

    def run_command(self):
        body = self.body()
        argv = body.get('argv')
        validate_argv(argv)
        if '-j' not in argv and '--json' not in argv:
            argv = argv + ['-j']
        return drive.run(argv)

    def upload(self, query):
        path = text_query(query, 'path')
        check_path(path)
        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_UPLOAD_BYTES:
            raise DriveError(413, 'Upload too large')

        directory = tempfile.mkdtemp(prefix='drive-upload-', dir=TMP_ROOT)
        try:
            reader = Pushback(self.rfile)
            budget = Budget(MAX_UPLOAD_BYTES)
            paths = parse_multipart(reader, self.headers.get('Content-Type', ''), budget, directory)
            if not paths:
                raise DriveError(400, 'No files in the upload')
            return drive.run(['filesystem', 'upload', '-j', *paths, path], timeout=TRANSFER_TIMEOUT, lock_timeout=TRANSFER_LOCK_TIMEOUT)
        finally:
            shutil.rmtree(directory, ignore_errors=True)

    def download(self, query):
        paths = query.get('path') or []
        if not paths:
            raise DriveError(400, 'path is required')
        for path in paths:
            if len(path) > 4096 or CONTROL_CHARS.search(path):
                raise DriveError(400, 'path is invalid')
            check_path(path)

        directory = tempfile.mkdtemp(prefix='drive-download-', dir=TMP_ROOT)
        try:
            result = drive.run(['filesystem', 'download', '-j', *paths, directory], timeout=TRANSFER_TIMEOUT, lock_timeout=TRANSFER_LOCK_TIMEOUT)
            if result['exitCode'] != 0:
                raise DriveError(502, result['stderr'].strip() or 'Proton Drive could not download the file')

            name = safe_filename(paths[0]) if len(paths) == 1 else 'drive-download'
            if len(paths) == 1:
                local = self.single_file(directory, paths[0])
                if local and os.path.isfile(local):
                    content_type = mimetypes.guess_type(local)[0] or 'application/octet-stream'
                    return self.stream_file(local, name, content_type)

            archive = os.path.join(directory, f'{name}.zip')
            self.zip_directory(directory, archive, exclude=archive)
            return self.stream_file(archive, f'{name}.zip', 'application/zip')
        finally:
            shutil.rmtree(directory, ignore_errors=True)

    def single_file(self, directory, path):
        """The file the CLI wrote, matching the requested path's last segment."""
        expected = safe_filename(path)
        candidate = os.path.join(directory, expected)
        if os.path.isfile(candidate):
            return candidate
        for entry in os.listdir(directory):
            if entry == expected:
                return os.path.join(directory, entry)
        files = [os.path.join(directory, entry) for entry in os.listdir(directory)]
        return files[0] if len(files) == 1 else None

    def zip_directory(self, directory, archive, exclude):
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
            for root, _, files in os.walk(directory):
                for name in files:
                    full = os.path.join(root, name)
                    if full == exclude:
                        continue
                    bundle.write(full, os.path.relpath(full, directory))

    def stream_file(self, path, name, content_type):
        size = os.path.getsize(path)
        # A quote or newline would break the header
        safe = CONTROL_CHARS.sub('', name).replace('"', '')
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(size))
        self.send_header('Content-Disposition', f'attachment; filename="{safe}"')
        self.end_headers()
        with open(path, 'rb') as file:
            shutil.copyfileobj(file, self.wfile, 65536)

    def body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length > 1024 * 1024:
            raise DriveError(413, 'Request too large')
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            raise DriveError(400, 'Invalid JSON')
        if not isinstance(body, dict):
            raise DriveError(400, 'Invalid JSON')
        return body

    def authorized(self, action):
        expected = f'Bearer {TOKEN}'.encode()
        if not hmac.compare_digest(self.headers.get('Authorization', '').encode(), expected):
            return self.reply(401, {'error': 'Unauthorized'})
        try:
            outcome = action()
        except DriveError as error:
            return self.reply(error.status, {'error': str(error)})
        except OSError:
            return self.reply(502, {'error': 'Proton Drive is not reachable'})
        # A stream already wrote its own response
        if isinstance(outcome, dict):
            self.reply(200, outcome)

    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        # Paths name the user's files; log only method and status
        print(f'{self.command} {self.path.split("?")[0]} {args[1] if len(args) > 1 else ""}', flush=True)


if __name__ == '__main__':
    if not shutil.which(CLI):
        print(f'{CLI} is not installed', file=sys.stderr, flush=True)
    ThreadingHTTPServer(('0.0.0.0', CONTROL_PORT), Handler).serve_forever()
