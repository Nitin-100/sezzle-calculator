package api

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

var (
	cacheForever = []string{"public, max-age=31536000, immutable"}
	revalidate   = []string{"no-cache"}
)

// newStaticHandler serves the built frontend. It answers GET and HEAD only,
// never lists directories, and sets cache headers for hashed asset names:
// files in /assets/ are cached forever, while index.html is always
// revalidated so a new release is picked up immediately. http.FileServer
// drops Cache-Control on error responses, so 404s are not cached.
func newStaticHandler(dir string) http.Handler {
	files := http.FileServer(noListingFS{http.Dir(dir)})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header()["Cache-Control"] = cacheForever
		} else {
			w.Header()["Cache-Control"] = revalidate
		}
		files.ServeHTTP(w, r)
	})
}

// noListingFS hides directories without an index.html, so the file server
// returns 404 for them instead of listing their contents. It also hides
// dotfiles (such as .env or .git), which http.Dir would otherwise serve.
type noListingFS struct{ fs http.FileSystem }

func (n noListingFS) Open(name string) (http.File, error) {
	if strings.Contains(name, "/.") {
		return nil, fs.ErrNotExist
	}
	f, err := n.fs.Open(name)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, err
	}
	if info.IsDir() {
		index, err := n.fs.Open(path.Join(name, "index.html"))
		if err != nil {
			_ = f.Close()
			return nil, fs.ErrNotExist
		}
		_ = index.Close()
	}
	return f, nil
}
