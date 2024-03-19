import re
import argparse
import os

# Function to unescape JSON strings in the SQL dump and enclose them within single quotes
def unescape_and_quote_json(sql_dump):
    # Define a regex pattern to match escaped JSON strings within SQL INSERT statements
    pattern = r'"([^"\\]*(\\.[^"\\]*)*)"'

    # Find all matches and unescape them, enclosing within single quotes
    unescaped_dump = re.sub(pattern, lambda x: "'" + x.group(1).replace('\\"', '"') + "'", sql_dump)

    return unescaped_dump

# Function to process a single file
def process_file(file_path, output_dir):
    try:
        with open(file_path, 'r') as file:
            sql_dump = file.read()
    except FileNotFoundError:
        print(f"Error: File not found: {file_path}")
        return

    # Unescape JSON strings and enclose within single quotes
    unescaped_and_quoted_dump = unescape_and_quote_json(sql_dump)

    # Write updated file
    output_file = os.path.join(output_dir, os.path.splitext(os.path.basename(file_path))[0] + '_json_escaped.sql')
    with open(output_file, 'w') as file:
        file.write(unescaped_and_quoted_dump)
    print(f"File processed: {file_path} -> {output_file}")

# Parse command line arguments
parser = argparse.ArgumentParser(description='Preformat mysql dump files for import')
group = parser.add_mutually_exclusive_group(required=True)
group.add_argument('--file', help='Path to MySQL dump file')
group.add_argument('--dir', help='Directory containing MySQL dump files')
parser.add_argument('--out', help='Output directory for processed files', required=True)
args = parser.parse_args()

output_dir = args.out

if args.file:
    process_file(args.file, output_dir)
elif args.dir:
    # Process all SQL files in the directory
    for filename in os.listdir(args.dir):
        if filename.endswith(".sql"):
            process_file(os.path.join(args.dir, filename), output_dir)
else:
    print("Error: No input option provided.")
