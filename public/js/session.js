export const session = { user: null, needsSetup: false, version: '' };
export const isAdmin = () => session.user?.role === 'admin';
