#!/bin/sh
# Only answer SSH password prompts, never host-key or other confirmation prompts.
case "$1" in
  *[Pp]assword:*) printf '%s\n' "$HERDRABBIT_SSH_PASSWORD" ;;
  *) exit 1 ;;
esac
