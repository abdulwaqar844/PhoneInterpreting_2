#!/bin/sh
services=$(find services -maxdepth 1 -mindepth 1 -type d)
set -e

echo "Installing dependencies in project root"
npm i

for service in ${services}
do
    if [ -f $service"/package.json" ]; then
        echo "Installing dependencies in " $service
        (cd "$service" && npm i)
    fi
done