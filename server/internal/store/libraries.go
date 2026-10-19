package store

import (
	"database/sql"
	"encoding/json"
	"errors"
)

func (s *Store) Libraries() ([]*Library, error) {
	rows, err := s.DB.Query(`SELECT l.id, l.name, l.type, l.paths, l.created_at, l.last_scan,
		(SELECT COUNT(*) FROM items i WHERE i.library_id=l.id AND i.type IN ('movie','series'))
		FROM libraries l ORDER BY l.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Library
	for rows.Next() {
		var l Library
		var paths string
		if err := rows.Scan(&l.ID, &l.Name, &l.Type, &paths, &l.CreatedAt, &l.LastScan, &l.ItemCount); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(paths), &l.Paths)
		out = append(out, &l)
	}
	return out, rows.Err()
}

func (s *Store) Library(id int64) (*Library, error) {
	var l Library
	var paths string
	err := s.DB.QueryRow(`SELECT id, name, type, paths, created_at, last_scan FROM libraries WHERE id=?`, id).
		Scan(&l.ID, &l.Name, &l.Type, &paths, &l.CreatedAt, &l.LastScan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(paths), &l.Paths)
	return &l, nil
}

func (s *Store) CreateLibrary(name, typ string, paths []string) (*Library, error) {
	res, err := s.DB.Exec(`INSERT INTO libraries(name, type, paths, created_at) VALUES (?,?,?,?)`, name, typ, mustJSON(paths), now())
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.Library(id)
}

func (s *Store) UpdateLibrary(id int64, name string, paths []string) error {
	_, err := s.DB.Exec(`UPDATE libraries SET name=?, paths=? WHERE id=?`, name, mustJSON(paths), id)
	return err
}

func (s *Store) DeleteLibrary(id int64) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM items_fts WHERE rowid IN (SELECT id FROM items WHERE library_id=?)`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM libraries WHERE id=?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) TouchLibraryScan(id int64) {
	_, _ = s.DB.Exec(`UPDATE libraries SET last_scan=? WHERE id=?`, now(), id)
}
