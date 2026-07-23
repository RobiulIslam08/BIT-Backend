import { ZodError } from 'zod';
import { TErrorSources, TGenericErrorResponse } from '../interface/error';

const handleZodError = (err: ZodError): TGenericErrorResponse => {
  const errorSources: TErrorSources = err.issues.map((issue) => {
    return {
      path: issue?.path[issue.path.length - 1] as string | number,
      message: issue.message,
    };
  });
  const statusCode = 400;
  const detail = errorSources
    .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
    .filter(Boolean)
    .join(' · ');

  return {
    statusCode,
    message: detail || 'Validation Error',
    errorSources,
  };
};

export default handleZodError;