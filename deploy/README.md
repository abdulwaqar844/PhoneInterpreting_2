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
