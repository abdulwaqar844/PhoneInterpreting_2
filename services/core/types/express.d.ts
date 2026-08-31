// eslint-disable-next-line import/no-extraneous-dependencies
import { NextFunction, Request, Response } from '@types/express';

export interface IRequest extends Request {
    files?: any;
    data?: {
        [key: string]: any;
    };
}

export interface IResponse extends Response {
}

export interface INextFunction extends NextFunction {
}

export type IMiddleware = (req: IRequest, res: IResponse, next: INextFunction) => Promise<unknown>;
