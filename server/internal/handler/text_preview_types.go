package handler

import (
	_ "embed"
	"encoding/json"
)

//go:embed text_preview_types.json
var textPreviewTypesJSON []byte

var (
	textPreviewExtensions   = make(map[string]bool)
	textPreviewContentTypes = make(map[string]bool)
	textPreviewBasenames    = make(map[string]bool)
)

func init() {
	var data struct {
		Extensions   []string `json:"extensions"`
		ContentTypes []string `json:"contentTypes"`
		Basenames    []string `json:"basenames"`
	}
	if err := json.Unmarshal(textPreviewTypesJSON, &data); err != nil {
		panic("handler: parse text_preview_types.json: " + err.Error())
	}
	for _, ext := range data.Extensions {
		textPreviewExtensions["."+ext] = true
	}
	for _, ct := range data.ContentTypes {
		textPreviewContentTypes[ct] = true
	}
	for _, bn := range data.Basenames {
		textPreviewBasenames[bn] = true
	}
}
