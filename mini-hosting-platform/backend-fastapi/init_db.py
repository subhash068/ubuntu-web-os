import pg8000.dbapi
import os

def create_database_if_not_exists():
    db_user = os.getenv("DB_USER", "postgres")
    db_pass = os.getenv("DB_PASS", "manager")
    db_host = os.getenv("DB_HOST", "localhost")
    db_port = int(os.getenv("DB_PORT", "5432"))
    target_db = os.getenv("DB_NAME", "mini_hosting_db")

    print(f"Connecting to database server at {db_host}:{db_port}...")
    try:
        # Connect to default system database to perform CREATE DATABASE
        conn = pg8000.dbapi.connect(
            user=db_user,
            password=db_pass,
            host=db_host,
            port=db_port,
            database="postgres"
        )
        # Set autocommit to True (required for CREATE DATABASE in PostgreSQL)
        conn.autocommit = True
        cur = conn.cursor()
        
        # Check if database exists
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (target_db,))
        exists = cur.fetchone()
        
        if not exists:
            print(f"Database '{target_db}' does not exist. Creating...")
            cur.execute(f"CREATE DATABASE {target_db}")
            print(f"Database '{target_db}' created successfully.")
        else:
            print(f"Database '{target_db}' already exists.")
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error during database initialization: {e}")
        raise e

if __name__ == "__main__":
    create_database_if_not_exists()
