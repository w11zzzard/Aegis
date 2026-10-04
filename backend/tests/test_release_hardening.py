"""Caller-scoped UI metadata and private local state remain security boundaries."""
import json
import os
import sqlite3
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend import credentials
from backend.main import ROOT, create_app
from backend.models import EvaluateRequest
from backend.state import StateStore
from backend.tests.test_security_fixes import TOKENS, headers, secure
from backend.tests.test_state_validation import PROPOSAL, ERROR, replace, stored, state_app, HEADERS


@pytest.mark.parametrize('user,role,admin', [('analyst_42', 'ANALYST', False), ('manager_1', 'PORTFOLIO_MANAGER', False), ('security_admin_1', 'SECURITY_ADMIN', True)])
def test_session_contains_only_current_verified_principal(secure, user, role, admin):
    response = secure.get('/api/session', headers=headers(user))
    assert response.status_code == 200
    assert response.json() == {'profile': 'authenticated', 'user': user, 'role': role, 'can_observe': admin, 'can_admin': admin}
    assert response.headers['cache-control'] == 'no-store'
    assert not any(token in response.text for token in TOKENS.values())


def test_session_does_not_accept_spoofed_header_or_missing_credentials(secure):
    assert secure.get('/api/session', headers={'X-Aegis-User': 'security_admin_1'}).status_code == 401


def test_explicit_demo_can_observe_but_cannot_administer_without_a_token():
    app = create_app(profile='local-demo', auth_tokens=TOKENS)
    with TestClient(app, base_url='http://localhost', client=('127.0.0.1', 50000)) as client:
        response = client.get('/api/session')
        assert response.status_code == 200
        assert response.json() == {'profile': 'local-demo', 'user': None, 'role': None, 'can_observe': True, 'can_admin': False}
        assert client.post('/api/redteam/run').status_code == 401
        admin = client.get('/api/session', headers=headers('security_admin_1'))
        assert admin.json() == {'profile': 'local-demo', 'user': 'security_admin_1', 'role': 'SECURITY_ADMIN', 'can_observe': True, 'can_admin': True}
        assert client.get('/api/session', headers={'Authorization': 'Bearer unknown'}).status_code == 401


def test_excessive_persisted_budget_principals_fail_closed_without_reset(state_app):
    state_app.state.gateway.evaluate(EvaluateRequest(**PROPOSAL, user='manager_1', role='PORTFOLIO_MANAGER'))
    state = json.loads(stored(state_app, 'gateway_state'))
    state['usage'] = {'user_' + str(i): [[1, 1]] for i in range(1001)}
    raw = json.dumps(state)
    replace(state_app, 'gateway_state', raw)
    with TestClient(state_app, base_url='http://localhost') as client:
        response = client.post('/api/security/evaluate', json=PROPOSAL, headers=HEADERS)
    assert response.status_code == 503 and response.json() == ERROR
    assert stored(state_app, 'gateway_state') == raw


@pytest.mark.skipif(os.name == 'nt', reason='POSIX modes are not Windows NTFS ACLs; verified in Linux CI')
def test_private_state_creation_does_not_depend_on_process_umask(tmp_path):
    path = tmp_path / 'private' / 'state.sqlite3'
    previous = os.umask(0)
    try:
        StateStore(path)
    finally:
        os.umask(previous)
    assert path.stat().st_mode & 0o777 == 0o600
    assert path.parent.stat().st_mode & 0o777 == 0o700


@pytest.mark.skipif(os.name == 'nt', reason='POSIX modes are not Windows NTFS ACLs; verified in Linux CI')
def test_state_refuses_other_account_writable_parent_before_creating_file(tmp_path):
    directory = tmp_path / 'shared'
    directory.mkdir()
    directory.chmod(0o777)
    path = directory / 'state.sqlite3'
    with pytest.raises(sqlite3.DatabaseError, match='directory must be private'):
        StateStore(path)
    assert not path.exists()


@pytest.mark.skipif(os.name == 'nt', reason='POSIX modes are not Windows NTFS ACLs; verified in Linux CI')
def test_state_refuses_public_existing_file_without_changing_it(tmp_path):
    path = tmp_path / 'state.sqlite3'
    path.write_bytes(b'SYNTHETIC_PRIVATE_STATE')
    path.chmod(0o644)
    with pytest.raises(sqlite3.DatabaseError, match='private regular file'):
        StateStore(path)
    assert path.read_bytes() == b'SYNTHETIC_PRIVATE_STATE'
    assert path.stat().st_mode & 0o777 == 0o644


@pytest.mark.skipif(os.name == 'nt', reason='Windows symlink creation requires privileges; verified in Linux CI')
def test_state_refuses_symlink_without_touching_its_target(tmp_path):
    target = tmp_path / 'target'
    target.write_bytes(b'SYNTHETIC_PRIVATE_STATE')
    path = tmp_path / 'state.sqlite3'
    path.symlink_to(target)
    with pytest.raises(sqlite3.DatabaseError, match='private regular file'):
        StateStore(path)
    assert target.read_bytes() == b'SYNTHETIC_PRIVATE_STATE'


def test_credential_generator_is_exclusive_and_never_prints_tokens(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv('AEGIS_POLICY_PATH', str(ROOT / 'policies/default.yaml'))
    with patch.object(credentials, '__file__', str(tmp_path / 'backend/credentials.py')):
        credentials.main()
        path = tmp_path / '.aegis/credentials.json'
        tokens = json.loads(path.read_text())
        assert set(tokens) == {'analyst_42', 'manager_1', 'security_admin_1', 'intern_1', 'senior_1'}
        assert len(set(tokens.values())) == len(tokens)
        assert all(len(token) >= 32 for token in tokens.values())
        output = capsys.readouterr().out
        assert not any(token in output for token in tokens.values())
        before = path.read_bytes()
        with pytest.raises(FileExistsError):
            credentials.main()
        assert path.read_bytes() == before
        if os.name != 'nt':
            assert path.parent.stat().st_mode & 0o777 == 0o700
            assert path.stat().st_mode & 0o777 == 0o600
