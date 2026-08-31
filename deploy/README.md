# Deployment

## Local deployment

Copy `deploy/local/.env.example` to `deploy/local/.env` and fill environment variables.

Run this in the root folder of the project:

`docker-compose --compatibility -p project_name -f deploy/local/docker-compose.yml up --force-recreate --build`

## Remote deployment (live)

### Prerequisite:

- Ubuntu 22.04 (or 20.04, 18.04)
- [Install and configure docker](https://www.digitalocean.com/community/tutorials/how-to-install-and-use-docker-on-ubuntu-22-04)
- [Install and configure gitlab runner](https://docs.gitlab.com/runner/install/)

### Using gitlab-ci:

- Create file `deploy/live/docker-compose.yml` (See `deploy/staging/docker-compose.yml` for reference)
- Create pipeline `.gitlab-ci.yml`:

```
update_live:
  stage: update_live
  image: dind
  tags:
    - GITLAB_RUNNER_TAG
  script:
    - docker-compose --compatibility -p PROJECT_NAME_${CI_COMMIT_REF_NAME} -f deploy/live/docker-compose.yml up -d --force-recreate --build
  environment:
    name: ${CI_COMMIT_REF_NAME}
  rules:
    - if: $CI_COMMIT_REF_NAME =~ /^(live)$/
      when: always
```

- Replace `GITLAB_RUNNER_TAG` with runner tag from gitlab runner configuration in `update_live` pipeline
- Replace `PROJECT_NAME` with project name in `update_live` pipeline
- Create CI/CD Variables:
  - Open gitlab repo
  - Go to `Settings => CI/CD`
  - Expand `Variables`
  - Add required variables
- Commit and push changes to `live` branch
- Check that pipeline successfully passed
