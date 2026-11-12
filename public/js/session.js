export const session = { user: null, needsSetup: false };
export const isAdmin = () => session.user?.role === 'admin';
