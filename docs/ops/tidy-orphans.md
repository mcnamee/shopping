# Tidy up orphans from the first failed deploy (user, CloudShell, Sydney, Trolley account)

1. List leftovers NOT used by the live stack (prints nothing = nothing to do):
```bash
aws cloudformation describe-stack-resources --stack-name TrolleyStack \
  --query "StackResources[].PhysicalResourceId" --output text | tr '\t' '\n' | sort > /tmp/live.txt
echo "== User pools =="; aws cognito-idp list-user-pools --max-results 30 \
  --query "UserPools[?Name=='trolley-users'].Id" --output text | tr '\t' '\n' | grep -vxFf /tmp/live.txt
echo "== Tables ==";     aws dynamodb list-tables --output text --query "TableNames[?starts_with(@,'TrolleyStack')]" | tr '\t' '\n' | grep -vxFf /tmp/live.txt
echo "== Buckets ==";    aws s3api list-buckets --output text --query "Buckets[?starts_with(Name,'trolleystack')].Name" | tr '\t' '\n' | grep -vxFf /tmp/live.txt
```
2. Delete only what was printed:
```bash
aws cognito-idp delete-user-pool --user-pool-id <ID>   # if protected: update-user-pool --deletion-protection INACTIVE first
aws dynamodb delete-table --table-name <NAME>
aws s3 rb s3://<NAME> --force
```
