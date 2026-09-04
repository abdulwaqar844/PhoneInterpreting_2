import { Request, Response } from 'express';

import { redisClient } from '../../../config/redis';
import { LANGUAGE_CACHE_KEY } from '../../../const/language/languageReference';
import { convertMiddlewareToAsync } from '../../../utils/rest/middlewares/convertMiddlewareToAsync';
import { logger } from '../../../config/logger';

const INTERPRETER_CACHE_PATTERN = 'interpreters:*';
const MEDIATOR_SNAPSHOT_CACHE_KEY = 'mediators:all:v1';

export const invalidateCache = convertMiddlewareToAsync(
  async (_req: Request, res: Response) => {
    const cacheKeys: string[] = [
      LANGUAGE_CACHE_KEY,
      MEDIATOR_SNAPSHOT_CACHE_KEY,
    ];

    try {
      if (!redisClient.isReady) {
        logger.error('[CacheInvalidation] Redis is not ready');
        res.status(503).json({
          success: false,
          error: 'Redis is not available',
        });
        return;
      }

      for await (const keys of redisClient.scanIterator({
        MATCH: INTERPRETER_CACHE_PATTERN,
        COUNT: 100,
      })) {
        cacheKeys.push(...keys);
      }

      const uniqueCacheKeys = [...new Set(cacheKeys)];
      const deletedKeyResults = await Promise.all(
        uniqueCacheKeys.map((key) => redisClient.del(key)),
      );
      const deletedKeys = deletedKeyResults.reduce(
        (total, deleted) => total + deleted,
        0,
      );

      logger.info(
        `[CacheInvalidation] deleted ${deletedKeys} cache key(s)`,
      );

      res.json({
        success: true,
        deletedKeys,
        invalidated: {
          languages: true,
          interpreters: true,
          mediators: true,
        },
      });
    } catch (error) {
      logger.error('[CacheInvalidation] failed to invalidate cache', error);
      res.status(500).json({
        success: false,
        error: 'Failed to invalidate cache',
      });
    }
  },
);
