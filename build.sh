#!/usr/bin/env bash
# FeatherBot Iterative Build Loop
# Runs Claude Code in fresh instances, one user story per iteration
# Usage: ./build.sh [max_iterations]
#   max_iterations: Maximum number of iterations (default: 10)

set -euo pipefail

MAX_ITERATIONS=${1:-10}
ITERATION=0
COMPLETE=false
TOOL="claude"
BRANCH_FILE=".last-branch"

echo "============================================"
echo "  FeatherBot Build Loop"
echo "  Max iterations: $MAX_ITERATIONS"
echo "  Tool: Claude Code"
echo "============================================"

# Check prerequisites
if ! command -v claude &> /dev/null; then
    echo "Error: claude CLI not found. Install Claude Code first."
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq not found. Install with: brew install jq"
    exit 1
fi

if [ ! -f "prd.json" ]; then
    echo "Error: prd.json not found. Run '/build-loop' skill first to create it."
    exit 1
fi

# Archive previous run if branch changed
CURRENT_BRANCH=$(jq -r '.branchName' prd.json)
if [ -f "$BRANCH_FILE" ]; then
    LAST_BRANCH=$(cat "$BRANCH_FILE")
    if [ "$LAST_BRANCH" != "$CURRENT_BRANCH" ]; then
        TIMESTAMP=$(date +%Y-%m-%d)
        ARCHIVE_DIR="archive/${TIMESTAMP}-${LAST_BRANCH//\//-}"
        echo "Branch changed from $LAST_BRANCH to $CURRENT_BRANCH"
        echo "Archiving previous run to $ARCHIVE_DIR"
        mkdir -p "$ARCHIVE_DIR"
        [ -f "prd.json" ] && cp prd.json "$ARCHIVE_DIR/"
        [ -f "progress.txt" ] && cp progress.txt "$ARCHIVE_DIR/"
    fi
fi
echo "$CURRENT_BRANCH" > "$BRANCH_FILE"

# Count remaining stories
remaining() {
    jq '[.userStories[] | select(.passes == false)] | length' prd.json
}

echo ""
echo "Stories remaining: $(remaining)"
echo ""

# Main loop
while [ $ITERATION -lt $MAX_ITERATIONS ] && [ "$COMPLETE" = false ]; do
    ITERATION=$((ITERATION + 1))
    REMAINING=$(remaining)

    if [ "$REMAINING" -eq 0 ]; then
        echo "All stories complete!"
        COMPLETE=true
        break
    fi

    CURRENT_STORY=$(jq -r '[.userStories[] | select(.passes == false)] | sort_by(.priority) | .[0].id + " - " + .[0].title' prd.json)

    echo "============================================"
    echo "  Iteration $ITERATION/$MAX_ITERATIONS"
    echo "  Stories remaining: $REMAINING"
    echo "  Working on: $CURRENT_STORY"
    echo "============================================"

    # Run Claude Code with fresh context
    OUTPUT=$(claude --dangerously-skip-permissions --print \
        "You are working on the FeatherBot project. Follow the instructions in CLAUDE.md exactly.

Read prd.json and progress.txt. Select the highest-priority incomplete story and implement it.
Follow the per-iteration steps in CLAUDE.md precisely.

Remember:
- Implement ONLY ONE story per iteration
- Run quality checks before committing
- Update prd.json to mark the story as passes: true
- Append your learnings to progress.txt
- If ALL stories are complete, respond with <promise>COMPLETE</promise>" 2>&1 | tee /dev/stderr)

    # Check for completion signal
    if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
        echo ""
        echo "============================================"
        echo "  BUILD COMPLETE"
        echo "  All stories implemented in $ITERATION iterations"
        echo "============================================"
        COMPLETE=true
    fi

    # Brief pause between iterations
    if [ "$COMPLETE" = false ]; then
        echo ""
        echo "Pausing 3 seconds before next iteration..."
        sleep 3
    fi
done

if [ "$COMPLETE" = false ]; then
    REMAINING=$(remaining)
    echo ""
    echo "============================================"
    echo "  MAX ITERATIONS REACHED ($MAX_ITERATIONS)"
    echo "  Stories remaining: $REMAINING"
    echo "  Run again: ./build.sh $MAX_ITERATIONS"
    echo "============================================"
    exit 1
fi

exit 0
