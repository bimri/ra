# seed

`horizon.json` holds the starting Horizon signals for each field. The Horizon shows these until Muse Wonder's first sourced refresh for that field replaces them with signals read from cited public pages.

Amani's demo mind (a junior developer whose entry-level work is being automated) is built in code, in `apps/worker/src/dev/amani.ts`, and loaded with `POST /dev/seed?person=amani` on a local Worker.
