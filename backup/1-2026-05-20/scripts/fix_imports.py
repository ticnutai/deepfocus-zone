#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, sys

SRC = os.path.join(os.path.dirname(__file__), '..', 'src', 'pages', 'PlanDetail.tsx')

with open(SRC, encoding='utf-8') as f:
    content = f.read()

OLD_IMPORT = 'import { ChevronRight, CheckCircle2, BookOpen, ArrowRight, CalendarCheck2, Bell, BellOff, Clock, RefreshCw, Calendar, Plus, Trash2, Check, X, ChevronDown, ChevronUp, RotateCcw, Pencil } from "lucide-react";'
NEW_IMPORT = 'import { ChevronRight, CheckCircle2, BookOpen, ArrowRight, CalendarCheck2, Bell, BellOff, Clock, RefreshCw, Calendar, Plus, Trash2, Check, X, ChevronDown, ChevronUp, RotateCcw, Pencil, List, CalendarDays, ChevronLeft } from "lucide-react";'

if OLD_IMPORT in content:
    content = content.replace(OLD_IMPORT, NEW_IMPORT)
    with open(SRC, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
    print("Import updated OK")
elif NEW_IMPORT in content:
    print("Import already up to date")
else:
    print("ERROR: import line not found")
    sys.exit(1)
