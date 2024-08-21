export const isDpid = (id: string) => /^[0-9]+$/.test(id);

export const isVersionString = (maybeVersion: string) => /v?\d/.test(maybeVersion);
