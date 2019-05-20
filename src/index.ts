import http from "http";
import parser from "xml2json";
import fs from "fs";
import pdf from "html-pdf";

interface Config {
  sitemapHost: string;
  sitemapUrl: string;
  saveDirRoot: string;
  fetchUrlParams?: string;
  stripTags?: string[];
  stripContent?: string[];
}

let Config: Config;

function fetchContent(url: string) {
  return new Promise((resolve, reject) => {
    http
      .get(url, response => {
        let data = "";
        response.on("data", (chunk: string) => {
          data += chunk;
        });
        response.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function getSitemapFiles(sitemapXml: string) {
  const sitemapJson = JSON.parse(parser.toJson(sitemapXml));
  let files: string[] = [];
  if (
    sitemapJson &&
    sitemapJson.sitemapindex &&
    sitemapJson.sitemapindex.sitemap
  ) {
    files = sitemapJson.sitemapindex.sitemap.map((file: any) => file.loc);
  }
  return files;
  // return files.slice(0, 2);
}

function cleanHtml(html: string) {
  let cleanHtml = html;
  if (Config.stripTags) {
    Config.stripTags.forEach(tag => {
      const removeRegexp = new RegExp(`<${tag}.*>[\\S\\s]*?<\/${tag}>`, "ig");
      cleanHtml = cleanHtml.replace(removeRegexp, "");
    });
  }

  if (Config.stripContent) {
    Config.stripContent.forEach(content => {
      cleanHtml = cleanHtml.replace(content, "");
    });
  }
  return cleanHtml;
}

async function fetchAndSaveHtml(
  url: string
): Promise<{ data: string; filename: string }> {
  let newUrl = url;
  if (Config.fetchUrlParams) {
    newUrl += `?${Config.fetchUrlParams}`;
  }
  let data = (await fetchContent(newUrl)) as string;
  data = cleanHtml(data);
  let filename = url
    .replace(Config.sitemapHost, "")
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/\//g, "-")
    .replace(".html", "");
  filename = filename || "index";
  const saveDir = `${Config.saveDirRoot}/html`;
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir);
  }
  fs.writeFileSync(`${saveDir}/${filename}.html`, data);
  return {
    data,
    filename
  };
}

function generatePdf(data: string, filename: string) {
  const saveDir = `${Config.saveDirRoot}/pdf`;
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir);
  }
  pdf.create(data).toFile(`${saveDir}/${filename}.pdf`, error => {
    if (error) {
      console.error(error);
    }
  });
}

async function saveHtml(files: string[]) {
  for (const file of files) {
    const urlXml = (await fetchContent(file)) as string;
    const urlJson = JSON.parse(parser.toJson(urlXml));
    if (urlJson && urlJson.urlset && urlJson.urlset.url) {
      if (Array.isArray(urlJson.urlset.url)) {
        console.log(
          `Fetching and saving ${urlJson.urlset.url.length} URL's ...`
        );
        const urls = urlJson.urlset.url;
        for (const url of urls) {
          const { data, filename } = await fetchAndSaveHtml(url.loc);
          generatePdf(data, filename);
        }
      } else {
        console.log(`Saving 1 URL ...`);
        fetchAndSaveHtml(urlJson.urlset.url.loc);
      }
    }
  }
}

function loadConfig() {
  const configFilePath = process.env.CONFIG_FILE;
  let config: Config;
  if (configFilePath) {
    config = JSON.parse(fs.readFileSync(configFilePath, "utf8"));
  } else {
    throw new Error("Missing config file");
  }
  return config;
}

(async () => {
  Config = loadConfig();
  console.log("Starting ...");
  console.log("Fetching main sitemap ...");
  const sitemapXml = await fetchContent(Config.sitemapUrl);
  const files = getSitemapFiles(sitemapXml as string);
  console.log(`Building site crawl list from ${files.length} files ...`);
  saveHtml(files);
})();
