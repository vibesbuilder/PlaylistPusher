# PlaylistPusher

**Titellisten in eine Spotify-Playlist importieren – und jeden Treffer prüfen, bevor etwas hinzugefügt wird.**

[English version](README.md)

![PlaylistPusher Prüfansicht](docs/screenshot.png)

PlaylistPusher ist eine kleine lokale Web-App für Radiosender, DJs und alle, die Titellisten (Sendeprotokolle, Setlists, CSV-Exporte) in eine Spotify-Playlist bringen wollen:

1. Liste einfügen oder Datei öffnen, dann die Ziel-Playlist wählen (oder eine neue anlegen)
2. Jeder Eintrag wird auf Spotify gesucht – die Treffer erscheinen **live** und sind nach Sicherheit farblich markiert
3. Falsche Treffer pro Titel korrigieren: Alternative wählen, neu suchen, Spotify-Link einfügen, reinhören oder überspringen – und die Reihenfolge per Drag & Drop ändern
4. Erst nach **Bestätigung** werden die Titel hinzugefügt

Die Oberfläche gibt es auf **Englisch und Deutsch** (Umschalter oben rechts).

> PlaylistPusher ist ein unabhängiges Projekt und steht in keiner Verbindung zu Spotify.

## Funktionen

- **Flexible Eingabe:** Zeilen „Interpret – Titel“ (auch mit Uhrzeit oder Nummer davor), CSV/TSV mit Kopfzeile, aus Excel kopierte Spalten, M3U/M3U8, Spotify-Links, ISRC-Codes
- **Kommt mit unsauberen Listen zurecht:** kaputte Umlaute, Unterstriche statt Leerzeichen, Tracknummern und Laufzeiten werden automatisch bereinigt
- **Zuverlässiger Abgleich:** unterschiedliche Schreibweisen und Umlaute, „feat.“-Angaben, vertauschte Reihenfolge, Radio Edit oder Albumversion; Karaoke-, Tribute- und nicht gewünschte Live-Versionen werden abgewertet
- **Duplikaterkennung** innerhalb der Liste und gegenüber der Ziel-Playlist
- **Eigene Reihenfolge:** Einträge per Drag & Drop in die Reihenfolge bringen, in der sie hinzugefügt werden
- **Hält Spotifys Limits ein:** verteilte Anfragen, Abbrechen und Fortsetzen jederzeit, Anfragestatistik
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

Das Repository über **Code → Download ZIP** herunterladen und entpacken oder mit git klonen.

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
4. **Prüfen** – grün: sicher (≥ 85 %) · gelb: bitte prüfen (60–85 %) · rot: unsicher oder nicht gefunden (< 60 %, wird nicht automatisch übernommen)
5. **Ändern** – öffnet Alternativen, ein Suchfeld, ein Feld für einen Spotify-Link, einen Player (*▶ Anhören*) und *Diesen Eintrag nicht importieren*
6. **Reihenfolge** – einen Eintrag am Griff ⠿ ziehen, um die Reihenfolge beim Hinzufügen zu ändern. Ist der Griff angewählt, verschieben auch die Pfeiltasten, Bild ↑/↓ sowie Pos1/Ende den Eintrag. *Ursprüngliche Reihenfolge wiederherstellen* macht alle Verschiebungen rückgängig.
7. **Importieren** – zeigt eine Zusammenfassung; hinzugefügt wird erst nach Bestätigung

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

Spotify begrenzt die Zahl der Anfragen für Apps im Development Mode. Das Limit teilen sich alle Development-Mode-Apps deines Spotify-Entwicklerkontos; Größe und Rücksetzzeitpunkt veröffentlicht Spotify nicht. PlaylistPusher sucht deshalb einen Eintrag nach dem anderen, verteilt die Anfragen und braucht nur ein bis zwei Suchen pro Eintrag.

- **Suche abbrechen** stoppt die Suche sofort; die bisherigen Treffer bleiben erhalten.
- Ist das Limit von Spotify erreicht, stoppt die Suche von selbst und behält ihre Treffer.
- **Suche fortsetzen** macht jederzeit mit den übrigen Einträgen weiter (und wiederholt fehlgeschlagene Suchen).
- Die Prüfansicht zeigt, wie viele Anfragen gesendet wurden – seit dem Laden der Seite, in der letzten Stunde und in den letzten 24 Stunden – und wann Spotify das Kontingent zuletzt als aufgebraucht gemeldet hat. So lassen sich die Limits für das eigene Konto herausfinden.

Tipp für lange Listen: als Ziel *+ Neue Playlist erstellen* wählen. Das Lesen einer bestehenden Playlist (für die Duplikatprüfung) kostet eine Anfrage pro 50 Titel.

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

## Lizenz

[MIT](LICENSE)
