#!/bin/sh
set -eu
psql --username postgres --dbname dalecrest --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password DALECREST_APP_PASSWORD
CREATE ROLE dalecrest_app LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB PASSWORD :'app_password';
ALTER DATABASE dalecrest OWNER TO dalecrest_app;
SQL
