#!/bin/sh

#
# Convert MP3 to HE-AAC v2 for audiobook binding
#

# continue through errors
set +e
set -u

HE_AAC_v2=28

mkdir -p ./m4a/
for my_mp3 in *.mp3; do
    my_name="$(basename "${my_mp3}" .mp3)"
    my_m4a="${my_name}.m4a"

    if ! test -r "./m4a/${my_m4a}"; then
        echo "Converting ${my_mp3}"
        ffmpeg -i "${my_mp3}" -c:a aac_at -profile:a "${HE_AAC_v2}" -b:a 32k "./m4a/${my_m4a}"
    else
        echo "Found ./m4a/${my_m4a}"
    fi
done
