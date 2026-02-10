#!/bin/bash -l
#SBATCH --job-name=ecmwf_op_clean
#SBATCH --output=ecmwf_op_clean_%j.log
#SBATCH --error=ecmwf_op_clean_%j.err
#SBATCH --time=01:00:00
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=4
#SBATCH --partition=work
#SBATCH --mem=64G

set -euo pipefail

export OMP_NUM_THREADS=1
export MKL_NUM_THREADS=1

module load python/3.11.6
source $MYSCRATCH/icrar_env/bin/activate

cd $MYSCRATCH
python -u ecmwf_op_clean.py config_ecmwf_op_clean.yaml
