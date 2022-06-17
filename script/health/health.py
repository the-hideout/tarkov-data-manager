import sys
import time

from requests_html import HTMLSession

URL = "https://manager.tarkov.dev"
TEXT_SEARCH = "Tarkov Data Manager"
RETRY_SLEEP = 2


def check():
    try:
        s = HTMLSession()
        response = s.get(URL)
        response.html.render()

        if TEXT_SEARCH in response.html.text:
            return True
        else:
            return False
    except:
        return False


def main():
    for i in range(0, 5):
        counter = i + 1
        if check():
            print(f"[{counter}] health: OK")
            sys.exit(0)
        else:
            time.sleep(RETRY_SLEEP)
            print(f"[{counter}] health: FAIL")
    sys.exit(1)


if __name__ == "__main__":
    main()
