import { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { TErrorSources } from '../interface/error';

import handleZodError from '../errors/handleZodError';
import handleValidationError from '../errors/handleValidationError';
import handleCastError from '../errors/handleCastError';
import handleDuplicateError from '../errors/handleDuplicateError';
import AppError from '../errors/AppError';
import config from '../config';

const globalErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let statusCode = 500;
  let message = 'Something went wrong!';
  let errorSources: TErrorSources = [
    {
      path: '',
      message: 'Something went wrong!',
    },
  ];

  if (err instanceof ZodError) {
    const simplifiedError = handleZodError(err);
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
    statusCode = simplifiedError.statusCode;
  } else if (err?.name === 'ValidationError') {
    const simplifiedError = handleValidationError(err);
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
    statusCode = simplifiedError.statusCode;
  } else if (err?.name === 'CastError') {
    const simplifiedError = handleCastError(err);
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
    statusCode = simplifiedError?.statusCode;
  } else if (err?.code === 11000) {
    const simplifiedError = handleDuplicateError(err);
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
    statusCode = simplifiedError?.statusCode;
  } else if (err instanceof AppError) {
    message = err?.message;
    errorSources = [
      {
        path: '',
        message: err?.message,
      },
    ];
    statusCode = err?.statusCode;
  } else if (err?.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    errorSources = [
      {
        path: '',
        message: 'Invalid token',
      },
    ];
  } else if (err?.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token has expired';
    errorSources = [
      {
        path: '',
        message: 'Token has expired',
      },
    ];
  } else if (err instanceof Error) {
    message = err?.message;
    errorSources = [
      {
        path: '',
        message: err?.message,
      },
    ];
  }

  res.status(statusCode).json({
    success: false,
    message,
    errorSources,
    stack: config.NODE_ENV === 'development' ? err?.stack : '',
  });
};

export default globalErrorHandler;