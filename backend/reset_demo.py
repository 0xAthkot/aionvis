"""Reset the backend to a clean demo state.

Deletes every run, dataset, model and upload plus the persisted state file,
so the next backend start reseeds just the org + projects. Run it with the
backend STOPPED (it edits files the server holds open):

    python reset_demo.py [--yes]
"""

import argparse
import shutil
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
TARGETS = ["state.json", "files", "runs", "byod", "predictions"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", action="store_true",
                        help="skip the confirmation prompt")
    args = parser.parse_args()

    existing = [t for t in TARGETS if (DATA_DIR / t).exists()]
    if not existing:
        print("Nothing to reset — data directory is already clean.")
        return

    print("Will delete from", DATA_DIR)
    for t in existing:
        print("  -", t)
    if not args.yes:
        answer = input("Proceed? [y/N] ").strip().lower()
        if answer not in ("y", "yes"):
            print("Aborted.")
            sys.exit(1)

    for t in existing:
        target = DATA_DIR / t
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        print("deleted", t)
    print("Done. Start the backend to reseed the demo org and projects.")


if __name__ == "__main__":
    main()
