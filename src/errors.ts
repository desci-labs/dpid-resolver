export class ResolverError<T extends string> extends Error {
    name: T;
    message: string;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    cause: any;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    constructor({ name, message, cause }: { name: T; message: string; cause?: any }) {
        super();
        this.name = name;
        this.message = message;
        this.cause = cause;
    }
}
