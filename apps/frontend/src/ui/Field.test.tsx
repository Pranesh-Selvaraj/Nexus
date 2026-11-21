import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Field } from './Field';

describe('Field', () => {
  it('labels the input and reports typed text', async () => {
    const onChange = vi.fn();
    render(
      <Field
        id="email"
        label="Email"
        onChange={onChange}
        placeholder="you@example.com"
      />,
    );

    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');

    expect(onChange).toHaveBeenCalled();
  });

  it('marks the input invalid and shows the error', () => {
    render(<Field id="password" label="Password" error="Too short" />);

    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByText('Too short')).toBeInTheDocument();
  });
});
