import { Router } from 'express';
import { webhookRoutes } from './webhook';

const apiRoutes = Router();

apiRoutes.use('/webhook', webhookRoutes);

apiRoutes.get('/', (req, res) => {
    res.status(200).json({
        message: 'Welcome to the API',
        routes: {
            webhook: '/api/webhook',
        },
    });
})

export { apiRoutes };
