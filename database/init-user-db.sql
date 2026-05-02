CREATE ROLE festivaladmin LOGIN PASSWORD '<strong_password>'
CREATE DATABASE festival_db;
GRANT CONNECT ON DATABASE festival_db TO festivaladmin;
GRANT CREATE ON DATABASE festival_db TO festivaladmin;
ALTER DATABASE festival_db SET search_path TO <schema_env>, public;
