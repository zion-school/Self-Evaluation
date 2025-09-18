#!/bin/bash
find . -type f -name "*.gift" | sed 's|^\./||' | sort > list.txt
