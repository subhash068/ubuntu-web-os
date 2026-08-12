import pg8000.dbapi
from contextlib import contextmanager
from backend.core.config import DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME
from backend.core import logger

def get_connection():
    try:
        conn = pg8000.dbapi.connect(
            host=DB_HOST,
            port=int(DB_PORT),
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        return conn
    except Exception as e:
        logger.error("database", "connect", str(e), host=DB_HOST, port=DB_PORT)
        return None

def execute(query: str, params=None) -> bool:
    conn = get_connection()
    if not conn:
        return False
    cursor = conn.cursor()
    try:
        cursor.execute(query, params or ())
        conn.commit()
        return True
    except Exception as e:
        logger.error("database", "execute", str(e), query=query)
        conn.rollback()
        return False
    finally:
        cursor.close()
        conn.close()

def fetch_one(query: str, params=None):
    conn = get_connection()
    if not conn:
        return None
    cursor = conn.cursor()
    try:
        cursor.execute(query, params or ())
        return cursor.fetchone()
    except Exception as e:
        logger.error("database", "fetch_one", str(e), query=query)
        return None
    finally:
        cursor.close()
        conn.close()

def fetch_all(query: str, params=None):
    conn = get_connection()
    if not conn:
        return []
    cursor = conn.cursor()
    try:
        cursor.execute(query, params or ())
        return cursor.fetchall()
    except Exception as e:
        logger.error("database", "fetch_all", str(e), query=query)
        return []
    finally:
        cursor.close()
        conn.close()

@contextmanager
def transaction():
    conn = get_connection()
    if not conn:
        raise ConnectionError("Database connection failed")
    cursor = conn.cursor()
    try:
        yield cursor
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cursor.close()
        conn.close()

def init_db():
    conn = get_connection()
    if conn:
        try:
            cur = conn.cursor()
            # Create table for notes
            cur.execute("""
                CREATE TABLE IF NOT EXISTS os_notes (
                    id SERIAL PRIMARY KEY,
                    content TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Create table for settings (windows layout, background, etc)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS os_settings (
                    id SERIAL PRIMARY KEY,
                    settings JSONB NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Create table for sessions
            cur.execute("""
                CREATE TABLE IF NOT EXISTS os_sessions (
                    session_id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    csrf TEXT NOT NULL,
                    exp FLOAT NOT NULL
                )
            """)
            
            # Ensure at least one row exists for each
            cur.execute("SELECT COUNT(*) FROM os_notes")
            if cur.fetchone()[0] == 0:
                cur.execute("INSERT INTO os_notes (content) VALUES ('')")
            
            cur.execute("SELECT COUNT(*) FROM os_settings")
            if cur.fetchone()[0] == 0:
                cur.execute("INSERT INTO os_settings (settings) VALUES ('{}'::jsonb)")
            conn.commit()
            cur.close()
            logger.info("database.init", status="success")
        except Exception as e:
            logger.error("database", "init_db", str(e))
            conn.rollback()
        finally:
            conn.close()
