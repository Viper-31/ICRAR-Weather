#!/bin/bash
#SBATCH --job-name=untar_data
#SBATCH --partition=work
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --time=01:30:00
#SBATCH --output=forecast_untar_%j.out
#SBATCH --error=forecast_untar_%j.err

set -euo pipefail

ARCHIVE_DIR="$MYSCRATCH/ecmwf_operational_raw"
EXTRACT_DIR="$MYSCRATCH/data/ecmwf_op_unzip"

mkdir -p "$EXTRACT_DIR"


export PIGZ="-p 4"

tar -I pigz -xf "$ARCHIVE_DIR/ecmwf_op_sfc_wswa_2025.tar.gz" -C "$EXTRACT_DIR"
tar -I pigz -xf "$ARCHIVE_DIR/ecmwf_op_pl_wswa_2025.tar.gz"  -C "$EXTRACT_DIR"
tar -I pigz -xf "$ARCHIVE_DIR/ecmwf_op_sfc_wswa_2024.tar.gz"  -C "$EXTRACT_DIR"
tar -I pigz -xf "$ARCHIVE_DIR/ecmwf_op_pl_wswa_2024.tar.gz"  -C "$EXTRACT_DIR"

echo "Extraction completed at $(date)"
