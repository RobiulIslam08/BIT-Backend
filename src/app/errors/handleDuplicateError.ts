import { TErrorSources, TGenericErrorResponse } from '../interface/error';

const handleDuplicateError = (err: {
  code?: number;
  keyValue?: Record<string, string | number>;
}): TGenericErrorResponse => {
  const statusCode = 400;

  // Extract key and value from err.keyValue
  const key = Object.keys(err.keyValue || {})[0] || '';
  const value = Object.values(err.keyValue || {})[0] || '';

  const errorSources: TErrorSources = [
    {
      path: key,
      message: `${value} already exists`,
    },
  ];

  return {
    statusCode,
    message: 'Duplicate Entry',
    errorSources,
  };
};

export default handleDuplicateError;