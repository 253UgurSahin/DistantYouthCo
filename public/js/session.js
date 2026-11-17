export const session = { user: null, needsSetup: false, version: '', uploadChunk: 0 };
export const isAdmin = () => session.user?.role === 'admin';
