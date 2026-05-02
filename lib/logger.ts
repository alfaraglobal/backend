export const devLog = process.env.NODE_ENV === 'development'
  ? (...args: unknown[]) => console.log('[dev]', ...args)
  : () => {};
