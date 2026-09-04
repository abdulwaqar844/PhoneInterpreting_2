# Deployment

## EC2 Instance Management Commands

### Start/Restart and Build Containers

From the root folder of the project:

```bash
sudo docker compose -p hospital-phone -f deploy/live/docker-compose.yml up -d --build --force-recreate
```

Or from the `deploy/live/` folder:

```bash
cd deploy/live/
sudo docker compose up --build -d
```

### View Logs

Follow all logs with timestamps:

```bash
sudo docker compose -p hospital-phone -f deploy/live/docker-compose.yml logs --tail=all --timestamps --follow
```

### Common Operations

**Stop containers:**

```bash
sudo docker compose -p hospital-phone -f deploy/live/docker-compose.yml down
```

**Restart containers:**

```bash
sudo docker compose -p hospital-phone -f deploy/live/docker-compose.yml restart
```

**View running containers:**

```bash
sudo docker compose -p hospital-phone -f deploy/live/docker-compose.yml ps
```

**Remove old images and containers (cleanup):**

```bash
sudo docker system prune -a
```

## Cache Invalidation Webhook

Call this webhook after updating the `languages` or `mediator` tables so the
next request loads fresh data from PostgreSQL:

```bash
curl -X POST https://your-domain/api/webhook/twilio/cache/invalidate
```

The webhook invalidates the language cache, all interpreter lookup caches, and
the mediator snapshot cache if it exists. It does not require a request body;
the caches are repopulated lazily on the next lookup.

Successful response example:

```json
{
  "success": true,
  "deletedKeys": 12,
  "invalidated": {
    "languages": true,
    "interpreters": true,
    "mediators": true
  }
}
```
