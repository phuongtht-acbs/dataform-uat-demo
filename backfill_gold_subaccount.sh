#!/bin/bash

# 1. Define the chronological list of dates to backfill
# You can generate this list using Excel or a small Python script and paste it here
DATES=(
  "2026-01-05"
  "2024-01-06"
  "2024-01-07"
  "2024-01-08"
  "2024-01-09"
)

# 2. Flag to track the first iteration
is_first_run=true

echo "Starting daily backfill for gold.subaccount_history..."

# 3. Loop through each date
for CURRENT_DATE in "${DATES[@]}"; do
  echo "---------------------------------------------------"
  
  if [ "$is_first_run" = true ]; then
    echo "Running FULL REFRESH for initial date: $CURRENT_DATE"
    
    # Run with --full-refresh to drop the table and create the initial state
    dataform run \
      --actions subaccount_history \
      --full-refresh \
      --vars target_date="$CURRENT_DATE"
      
    # Set flag to false so subsequent runs are incremental
    is_first_run=false
    
  else
    echo "Running INCREMENTAL run for date: $CURRENT_DATE"
    
    # Run normally (incremental) to process SCD2 changes
    dataform run \
      --actions subaccount_history \
      --vars target_date="$CURRENT_DATE"
  fi

done

echo "---------------------------------------------------"
echo "Backfill complete!"