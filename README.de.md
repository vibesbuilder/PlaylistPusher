# PlaylistPusher

**Titellisten in eine Spotify-Playlist importieren – und jeden Treffer prüfen, bevor etwas hinzugefügt wird.**

[English version](README.md)

![PlaylistPusher Prüfansicht](docs/screenshot.png)

PlaylistPusher ist eine kleine lokale Web-App für Radiosender, DJs und alle, die Titellisten (Sendeprotokolle, Setlists, CSV-Exporte) in eine Spotify-Playlist bringen wollen:

1. Liste einfügen oder Datei öffnen, dann die Ziel-Playlist wählen (oder eine neue anlegen)
2. Jeder Eintrag wird auf Spotify gesucht – die Treffer erscheinen **live** und sind nach Sicherheit farblich markiert
3. Falsche Treffer pro Titel korrigieren: Alternative wählen, neu suchen, Spotify-Link einfügen, reinhören, Einträge entfernen – und die Reihenfolge per Drag & Drop ändern
4. Erst nach **Bestätigung** werden die Titel hinzugefügt

Die Oberfläche gibt es auf **Englisch und Deutsch** (Umschalter oben rechts).

> PlaylistPusher ist ein unabhängiges Projekt und steht in keiner Verbindung zu Spotify.

## Funktionen

- **Flexible Eingabe:** Zeilen „Interpret – Titel“ (auch mit Uhrzeit oder Nummer davor), CSV/TSV mit Kopfzeile, aus Excel kopierte Spalten, M3U/M3U8, Spotify-Links, ISRC-Codes
- **Kommt mit unsauberen Listen zurecht:** kaputte Umlaute, Unterstriche statt Leerzeichen, Tracknummern und Laufzeiten werden automatisch bereinigt
- **Zuverlässiger Abgleich:** unterschiedliche Schreibweisen und Umlaute, „feat.“-Angaben, vertauschte Reihenfolge, Radio Edit oder Albumversion; Karaoke-, Tribute- und nicht gewünschte Live-Versionen werden abgewertet
- **Duplikaterkennung** innerhalb der Liste und gegenüber der Ziel-Playlist
- **Schnell aufräumen:** Einträge einzeln oder mehrere auf einmal entfernen – mit Rückgängig
- **Liste der fehlenden Titel:** die nicht importierten Einträge als Textdatei speichern – um sie später zu suchen oder erneut zu laden
- **Eigene Reihenfolge:** Einträge per Drag & Drop in die Reihenfolge bringen, in der sie hinzugefügt werden
- **Hält Spotifys Limits ein:** verteilte Anfragen, Abbrechen und Fortsetzen jederzeit, Übersicht über alle gesendeten Anfragen
- **Nichts geht verloren:** Der Prüfstand wird im Browser gespeichert und nach Neuladen oder erneuter Anmeldung wiederhergestellt
- **Läuft lokal:** keine Pakete, kein Cloud-Dienst – Python liefert die Oberfläche aus, der Browser spricht direkt mit der Spotify Web API
- **Demo-Modus** zum Ausprobieren ohne Spotify-Konto

## Voraussetzungen

- **Python 3.9 oder neuer** (keine zusätzlichen Pakete)
- Ein aktueller Browser (Chrome, Edge, Firefox oder Safari 15.4+)
- Ein Spotify-Konto und eine eigene Spotify-App (kostenlos, siehe [Einrichtung](#3-spotify-app-anlegen-einmalig))

> **Spotify-Vorgaben für Apps im Development Mode:** Der Besitzer der Spotify-App braucht **Spotify Premium**. Bis zu 5 weitere Spotify-Konten können unter *User Management* freigeschaltet werden.

## Installation

### 1. PlaylistPusher herunterladen

Die [aktuelle Version](https://github.com/vibesbuilder/PlaylistPusher/releases/latest) herunterladen (*Source code (zip)*) und entpacken – oder das Repository mit git klonen.

### 2. Python installieren (falls nötig)

Prüfen mit `python --version` (Windows) bzw. `python3 --version` (macOS/Linux).

- **Windows:** von [python.org](https://www.python.org/downloads/) installieren und *Add python.exe to PATH* anhaken – oder `winget install Python.Python.3.12` ausführen
- **macOS:** von [python.org](https://www.python.org/downloads/) oder mit Homebrew: `brew install python`
- **Linux:** meist vorinstalliert; sonst `python3` über die Paketverwaltung installieren

### 3. Spotify-App anlegen (einmalig)

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) öffnen und anmelden
2. **Create app** klicken – Name und Beschreibung sind beliebig
3. Bei **Redirect URIs** genau das eintragen:
   ```
   http://127.0.0.1:8138/callback
   ```
   (`localhost` akzeptiert Spotify hier nicht.)
4. Bei *Which API/SDKs are you planning to use?* **Web API** anhaken, den Bedingungen zustimmen und speichern
5. In den App-Einstellungen die **Client ID** kopieren
6. Optional: weitere Spotify-Konten, die die App nutzen sollen, unter **User Management** eintragen

### 4. Starten

- **Windows:** `PlaylistPusher.cmd` doppelklicken
- **macOS/Linux:** im Projektordner `python3 playlistpusher.py` ausführen

Der Browser öffnet `http://127.0.0.1:8138`. Oben rechts auf **DE** umschalten, Client ID einfügen, bei Spotify anmelden – fertig.
Das Konsolenfenster muss offen bleiben, solange PlaylistPusher benutzt wird; beenden mit Strg+C oder Fenster schließen.

## Benutzung

1. **Titelliste** – einfügen, *Datei öffnen…* klicken oder eine Datei ins Fenster ziehen
2. **Ziel-Playlist** – neben der Liste eine eigene Playlist wählen oder *+ Neue Playlist erstellen*. Befüllt werden können nur Playlists, die dir gehören oder bei denen du mitarbeitest.
3. **Titel suchen** – die Treffer erscheinen schon während der Suche. *Suche abbrechen* stoppt sie, *Suche fortsetzen* macht später weiter. Die Ziel-Playlist lässt sich oben in der Prüfansicht noch ändern.
4. **Prüfen** – grün: sicher (≥ 85 %) · gelb: bitte prüfen (60–85 %) · rot: unsicher oder nicht gefunden (< 60 %). Unsichere und nicht gefundene Einträge werden nicht importiert (Kennzeichnung *nicht importiert*).
5. **Ändern** (Stift-Symbol) – öffnet Alternativen, ein Suchfeld, ein Feld für einen Spotify-Link und einen Player (*▶ Anhören*). Den richtigen Track anklicken, um ihn zu übernehmen – das bestätigt auch einen unsicheren Treffer.
6. **Entfernen** (Papierkorb-Symbol) – entfernt einen Eintrag aus der Liste. Für mehrere Einträge deren Kästchen anhaken (Umschalt-Klick wählt einen Bereich, *Alle angezeigten auswählen* wählt alles, was der aktive Filter zeigt), dann unten *Entfernen* klicken oder die Entf-Taste drücken. *Rückgängig* holt entfernte Einträge zurück.
7. **Reihenfolge** – einen Eintrag am Griff ⠿ ziehen, um die Reihenfolge beim Hinzufügen zu ändern. Ist der Griff angewählt, verschieben auch die Pfeiltasten, Bild ↑/↓ sowie Pos1/Ende den Eintrag. *Ursprüngliche Reihenfolge wiederherstellen* macht alle Verschiebungen rückgängig.
8. **Importieren** – zeigt eine Zusammenfassung; hinzugefügt wird erst nach Bestätigung
9. **Nicht importierte speichern** – *Nicht importierte speichern (n)* in der Prüfansicht oder *Als Textdatei speichern* nach dem Import speichert alle Einträge, die nicht in der Playlist sind (nicht gefunden, unsicher oder nicht gesucht), als Textdatei: ein „Interpret - Titel“ pro Zeile, jeder Titel nur einmal. Die Datei lässt sich wieder in PlaylistPusher laden.

Tipp: Um alles loszuwerden, was nicht gefunden wurde, den Filter *Unsicher / nicht gefunden* wählen, *Alle angezeigten auswählen* anhaken und *Entfernen* klicken.

### Kommandozeile

```bash
python playlistpusher.py titel.txt
python playlistpusher.py titel.txt "Morningshow"
python playlistpusher.py titel.csv "Neue Playlist" --order title-artist
```

Mit Liste **und** Playlist startet die Suche sofort. Die Playlist kann als Name, Link oder ID angegeben werden; gibt es keine Playlist mit dem Namen, wird beim Import eine neue private Playlist angelegt. Unter Windows kann eine Listendatei auch auf `PlaylistPusher.cmd` gezogen werden.

| Option | Beschreibung |
|---|---|
| `--order auto\|artist-title\|title-artist` | Reihenfolge von Interpret und Titel in der Liste (Standard: `auto`) |
| `--port 8138` | Port der lokalen Oberfläche – muss zur Redirect-URI der Spotify-App passen |
| `--no-browser` | Browser nicht automatisch öffnen |

### Unterstützte Listen

| Format | Beispiel |
|---|---|
| Ein Titel pro Zeile | `Queen - Bohemian Rhapsody` (Trenner `-`, `–`, `—`, `\|`, ` / `) |
| Mit Uhrzeit, Datum oder Nummer davor | `14:03:22 Falco – Rock Me Amadeus`, `12. Wanda - Bologna`, `01 Wanda - Bologna` |
| Titel – Interpret | wird automatisch erkannt oder unter *Reihenfolge* eingestellt |
| CSV/TSV mit Kopfzeile | Spalten `Interpret`/`Artist`, `Titel`/`Title`/`Track`/`Song`, optional `Album`, `Dauer`, `ISRC`, `Spotify URI` (kompatibel mit Exportify-Exporten) |
| Aus Excel kopierte Spalten | Interpret- und Titelspalte markieren, kopieren, einfügen |
| M3U / M3U8 | `#EXTINF`-Zeilen oder Dateinamen wie `01 - Interpret - Titel.mp3` |
| Spotify-Links und ISRC | `https://open.spotify.com/track/…`, `spotify:track:…`, `USRC17607839` |

Leerzeilen und Zeilen mit `#` oder `//` am Anfang werden ignoriert. Dateien in UTF-8, UTF-16 und Windows-1252 (ANSI) werden automatisch erkannt.

Unsaubere Zeilen werden vor der Suche bereinigt: kaputte Umlaute wie `Ã¤` werden zu `ä`, Unterstriche gelten als Leerzeichen (`Queen_-_Bohemian_Rhapsody`), und Laufzeiten am Zeilenende (`3:55`) werden ignoriert. Zeilen ohne erkennbares Trennzeichen werden als Freitext gesucht.

### Demo

`http://127.0.0.1:8138/?demo` öffnen (oder den Demo-Link auf der Einrichtungsseite nutzen), um PlaylistPusher mit einem kleinen Beispielkatalog auszuprobieren. Die Demo greift nicht auf Spotify zu und ändert nichts.

## Anfrage-Limits von Spotify

Spotify begrenzt die Zahl der Anfragen für Apps im Development Mode. Das Limit teilen sich alle Development-Mode-Apps deines Spotify-Entwicklerkontos; Größe und Rücksetzzeitpunkt veröffentlicht Spotify nicht. PlaylistPusher sucht deshalb einen Eintrag nach dem anderen, verteilt die Anfragen und braucht eine Suche pro Eintrag – zwei, wenn die erste nichts Passendes findet.

> **Richtwert aus Tests:** Nach etwa **1.000 Anfragen innerhalb von 24 Stunden** war das Kontingent aufgebraucht, danach war die App etwa 24 Stunden gesperrt. Je nachdem, wie viele Einträge schon mit der ersten Suche gefunden werden, reicht das für etwa 500–1.000 Listeneinträge pro Tag. Das ist keine offizielle Angabe von Spotify und kann sich jederzeit ändern.

- **Suche abbrechen** stoppt die Suche sofort; die bisherigen Treffer bleiben erhalten.
- Ist das Limit von Spotify erreicht, stoppt die Suche von selbst und behält ihre Treffer.
- **Suche fortsetzen** macht jederzeit mit den übrigen Einträgen weiter (und wiederholt fehlgeschlagene Suchen).
- Unter *Titel suchen* schätzt PlaylistPusher, wie viele Anfragen die Liste braucht, und warnt, wenn das mehr sein könnte, als vom Richtwert noch übrig ist.
- **Spotify-Anfragen (24 h): … / ~1.000** oben rechts zeigt, wie viele Anfragen in den letzten 24 Stunden gesendet wurden (ab 80 % des Richtwerts gelb, ab 100 % rot). Ein Klick darauf öffnet die Übersicht: Anfragen seit dem Laden der Seite, in der letzten Stunde und in den letzten 24 Stunden, Anfragen pro Stunde der letzten 48 Stunden sowie jeder Zeitpunkt, an dem Spotify das Kontingent als aufgebraucht gemeldet hat – mit der Zahl der Anfragen in den 24 Stunden davor. *Statistik zurücksetzen* beginnt eine neue Messung.

Tipps für lange Listen:

- Als Ziel *+ Neue Playlist erstellen* wählen. Das Lesen einer bestehenden Playlist (für die Duplikatprüfung) kostet eine Anfrage pro 50 Titel.
- In Teilen importieren: die Suche nach einigen hundert Einträgen abbrechen, die bisherigen Treffer importieren, dann fortsetzen. Der Import braucht nur eine Anfrage pro 100 Titel, ist aber nicht mehr möglich, sobald das Kontingent aufgebraucht ist.

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| *Port 8138 is already in use* | PlaylistPusher läuft schon in einem anderen Fenster – dieses schließen. Oder mit `--port 8139` starten und `http://127.0.0.1:8139/callback` zusätzlich als Redirect-URI in der Spotify-App eintragen. |
| Spotify zeigt *INVALID_CLIENT: Invalid redirect URI* | Die Redirect-URI in der Spotify-App muss exakt `http://127.0.0.1:8138/callback` lauten. |
| *Das Anfrage-Kontingent deiner Spotify-App ist aufgebraucht* | Das Anfrage-Limit von Spotify ist erreicht (siehe oben). Eine Weile warten, dann *Suche fortsetzen* klicken. |
| *Spotify lehnt Anfragen ab, weil zu viele in kurzer Zeit gesendet wurden* | Eine Minute warten, dann *Suche fortsetzen* klicken. |
| *Zugriff verweigert (403): Insufficient client scope* | Ab- und wieder anmelden und die aktuelle Version von PlaylistPusher verwenden. |
| *Zugriff verweigert (403)* | Das Spotify-Konto in der Spotify-App unter *User Management* eintragen; der App-Besitzer braucht Premium. |
| *Die Spotify-Sitzung ist abgelaufen* | Neu anmelden (Spotify verlangt das spätestens alle 6 Monate). Die Liste bleibt erhalten. |
| *Der Arbeitsstand konnte nicht im Browser gespeichert werden* | Die Liste ist zu groß für den Browser-Speicher. Den Tab bis zum Import offen lassen. |

Fehlermeldungen nennen den Schritt, der fehlgeschlagen ist (z. B. *Suche: …* oder *Playlists laden: …*). Details zu fehlgeschlagenen Anfragen stehen zusätzlich in der Browser-Konsole (F12).

## Datenschutz

- Der lokale Server lauscht nur auf `127.0.0.1` und ist von anderen Rechnern aus nicht erreichbar.
- Die Anmeldung nutzt OAuth mit PKCE – ein Client Secret wird weder benötigt noch gespeichert.
- Zugangstoken, Prüfstand und Anfragestatistik liegen nur im Browser (localStorage von `http://127.0.0.1:8138`); Zugangstoken werden nur an Spotify gesendet.

## Entwicklung

Aufbau und Tests sind im [englischen README](README.md#development) beschrieben. Die Texte der Oberfläche stehen in `web/js/i18n.js`.

## Feedback

Fehler gefunden oder eine Idee? Bitte ein [Issue](https://github.com/vibesbuilder/PlaylistPusher/issues/new/choose) anlegen – die Titelliste kann als Textdatei angehängt werden. PlaylistPusher wird derzeit von einer Person entwickelt; Pull Requests werden deshalb vorerst nicht angenommen (siehe [CONTRIBUTING](CONTRIBUTING.md)). Sicherheitsprobleme: siehe [SECURITY](SECURITY.md).

## Lizenz

[MIT](LICENSE)
