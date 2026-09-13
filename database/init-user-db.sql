CREATE ROLE festivaladmin LOGIN PASSWORD '<strong_password>'
CREATE DATABASE festival_sepv2_db;
GRANT CONNECT ON DATABASE festival_sepv2_db TO festivaladmin;
GRANT CREATE ON DATABASE festival_sepv2_db TO festivaladmin;

