export class NotImplementedError extends Error { constructor(fn: string) { super(`${fn} is not implemented yet`); this.name = 'NotImplementedError' } }
