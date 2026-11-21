import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// `globals: false` keeps the test files explicit; that also means React
// Testing Library cannot auto-register its cleanup, so do it here.
afterEach(cleanup);
