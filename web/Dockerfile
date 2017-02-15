FROM rocker/shiny:latest
WORKDIR /srv/shiny-server
COPY . /srv/shiny-server/twi
RUN R -e "install.packages(c('rredis', 'RJSONIO'), repos='http://cran.rstudio.com/')"
