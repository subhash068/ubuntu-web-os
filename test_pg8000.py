import threading
import pg8000.dbapi

def worker():
    try:
        conn = pg8000.dbapi.connect(user='postgres', password='manager', host='localhost', port=5432, database='ubuntu_web_os')
        cur = conn.cursor()
        cur.execute('SELECT content FROM os_notes ORDER BY id DESC LIMIT 1')
        res = cur.fetchone()
        print('res:', res)
        cur.close()
        conn.close()
    except Exception as e:
        print("Error:", e)

t = threading.Thread(target=worker)
t.start()
t.join()
