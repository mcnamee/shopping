#!/usr/bin/env bash
# Invite a user to Trolley (Cognito admin-create-user).
#
# Usage:
#   scripts/create-user.sh <email> <householdId>            # invite a new user
#   scripts/create-user.sh <email> <householdId> --resend   # re-send an expired invite
#
# Cognito emails the user a temporary password; they choose their own on first sign-in.
# Both members of a household MUST be created with the SAME householdId - that is what
# lets them share lists. householdId: 3-64 chars of letters, digits, '-' or '_'.
#
# Requires the AWS CLI with credentials for the account (AWS CloudShell works).
# Env overrides: STACK_NAME (default TrolleyStack), AWS_REGION (default ap-southeast-2).
set -euo pipefail

usage() {
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

[[ $# -ge 2 && $# -le 3 ]] || usage
EMAIL="$1"
HOUSEHOLD_ID="$2"
MODE="${3:-}"
STACK_NAME="${STACK_NAME:-TrolleyStack}"
REGION="${AWS_REGION:-ap-southeast-2}"

if [[ ! "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Error: '$EMAIL' doesn't look like an email address." >&2
  exit 1
fi
if [[ ! "$HOUSEHOLD_ID" =~ ^[A-Za-z0-9_-]{3,64}$ ]]; then
  echo "Error: householdId must be 3-64 characters of letters, digits, '-' or '_'." >&2
  exit 1
fi
if [[ -n "$MODE" && "$MODE" != "--resend" ]]; then
  usage
fi

command -v aws >/dev/null || { echo "Error: the AWS CLI is not installed." >&2; exit 1; }

USER_POOL_ID="$(aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text)"

if [[ -z "$USER_POOL_ID" || "$USER_POOL_ID" == "None" ]]; then
  echo "Error: could not find the UserPoolId output on stack $STACK_NAME in $REGION." >&2
  exit 1
fi

ARGS=(
  --region "$REGION"
  --user-pool-id "$USER_POOL_ID"
  --username "$EMAIL"
  --desired-delivery-mediums EMAIL
)
if [[ "$MODE" == "--resend" ]]; then
  ARGS+=(--message-action RESEND)
else
  ARGS+=(
    --user-attributes
    "Name=email,Value=$EMAIL"
    "Name=email_verified,Value=true"
    "Name=custom:householdId,Value=$HOUSEHOLD_ID"
  )
fi

if ! OUTPUT="$(aws cognito-idp admin-create-user "${ARGS[@]}" \
  --query "User.{Username:Username,Status:UserStatus}" --output table 2>&1)"; then
  if [[ "$OUTPUT" == *UsernameExistsException* ]]; then
    echo "Error: $EMAIL already has an account. Nothing was changed." >&2
    echo "To re-send an expired invite: $0 $EMAIL $HOUSEHOLD_ID --resend" >&2
  elif [[ "$OUTPUT" == *UserNotFoundException* ]]; then
    echo "Error: $EMAIL has no account to re-send to; run without --resend." >&2
  else
    echo "$OUTPUT" >&2
  fi
  exit 1
fi
echo "$OUTPUT"

echo
echo "Invited $EMAIL to household '$HOUSEHOLD_ID'."
echo "They'll get an email with a temporary password (valid for 7 days)."
