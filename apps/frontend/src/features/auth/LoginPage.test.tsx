import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAuthConfig, login, register } from '../../lib/auth';
import { LoginPage } from './LoginPage';

vi.mock('../../lib/auth', () => ({
  fetchAuthConfig: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
}));

const mocked = {
  fetchAuthConfig: vi.mocked(fetchAuthConfig),
  login: vi.mocked(login),
  register: vi.mocked(register),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAuthConfig.mockResolvedValue({
    authEnabled: true,
    registrationEnabled: true,
    localEmail: null,
  });
  mocked.login.mockResolvedValue({ ok: true, status: 200 });
});

describe('LoginPage', () => {
  it('offers sign-in and registration when the instance allows it', async () => {
    render(<LoginPage onAuthed={() => {}} />);

    expect(
      await screen.findByRole('tab', { name: 'Create account' }),
    ).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Sign in' })).toBeVisible();
  });

  it('signs in and reports success to the caller', async () => {
    const onAuthed = vi.fn();
    render(<LoginPage onAuthed={onAuthed} />);
    await screen.findByRole('tab', { name: 'Create account' });

    await userEvent.type(screen.getByLabelText('Email'), 'local@nexus.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'nexus');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(onAuthed).toHaveBeenCalledOnce());
    expect(mocked.login).toHaveBeenCalledWith('local@nexus.dev', 'nexus');
  });

  it('shows the mapped error and clears the rejected password', async () => {
    mocked.login.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'That email and password do not match.',
    });
    render(<LoginPage onAuthed={() => {}} />);
    await screen.findByRole('tab', { name: 'Create account' });

    await userEvent.type(screen.getByLabelText('Email'), 'local@nexus.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email and password do not match.',
    );
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('offers the local account and hides the register tab on a closed instance', async () => {
    mocked.fetchAuthConfig.mockResolvedValue({
      authEnabled: true,
      registrationEnabled: false,
      localEmail: 'local@nexus.dev',
    });
    render(<LoginPage onAuthed={() => {}} />);

    const useLocal = await screen.findByRole('button', {
      name: /Use local@nexus\.dev/,
    });
    expect(screen.queryByRole('tab', { name: 'Create account' })).toBeNull();

    await userEvent.click(useLocal);
    expect(screen.getByLabelText('Email')).toHaveValue('local@nexus.dev');
  });
});
