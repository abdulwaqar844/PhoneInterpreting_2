import express from 'express';
import { urlencoded } from 'body-parser';
import { createServer } from 'node:http';

import { apiRoutes } from '../rest';

const app = express();

app.use(urlencoded({ extended: false }));

app.use('/api', apiRoutes);

const httpServer = createServer(app);

export { app, httpServer };
