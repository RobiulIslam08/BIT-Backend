import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
import catchAsync from '../utils/catchAsync';

//validation
const validateRequest = (schema: ZodSchema) => {
  return catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    //valiction check => ok => next()
    const parsed = (await schema.parseAsync({
      body: req.body,
      cookies: req.cookies,
    })) as { body: Record<string, unknown>; cookies: Record<string, unknown> };
    req.body = parsed.body;
    req.cookies = parsed.cookies;
    next();
  });
};
export default validateRequest;