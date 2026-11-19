class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const badRequest = (code, msg) => new HttpError(400, code, msg);
const notFound = (code = 'not_found', msg) => new HttpError(404, code, msg);
const conflict = (code, msg) => new HttpError(409, code, msg);

// Express 4 khong tu bat loi async -> boc handler
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, badRequest, notFound, conflict, wrap };
